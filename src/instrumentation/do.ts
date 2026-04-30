import { context as api_context, trace, SpanOptions, SpanKind, Exception, SpanStatusCode } from '@opentelemetry/api'
import { SemanticAttributes } from '@opentelemetry/semantic-conventions'
import { passthroughGet, unwrap, wrap } from '../wrap.js'
import {
	getParentContextFromHeaders,
	gatherIncomingCfAttributes,
	gatherRequestAttributes,
	gatherResponseAttributes,
	instrumentClientFetch,
} from './fetch.js'
import { instrumentEnv } from './env.js'
import { Initialiser, setConfig } from '../config.js'
import { instrumentStorage } from './do-storage.js'
import { DOConstructorTrigger } from '../types.js'

import { DurableObject as DurableObjectClass } from 'cloudflare:workers'

type DO = DurableObject | DurableObjectClass
type FetchFn = DurableObject['fetch']
type AlarmFn = DurableObject['alarm']
type Env = Record<string, unknown>

// Properties on `DurableObjectStub` that are NOT user RPC methods.
// Accessing these never produces an RPC; we let them pass through
// untouched so we don't accidentally wrap iterators/serializers.
const STUB_NON_RPC_PROPS = new Set<string | symbol>([
	'fetch',
	'id',
	'name',
	'connect',
	// Symbol.toPrimitive, Symbol.iterator, etc. — covered below by typeof check.
])

// Return a function that, when called, dispatches the RPC by reading
// the method off the underlying stub at call-time and applying it.
// We do NOT probe the value at proxy `get` time because CF DO stubs
// are themselves Proxies — user-defined RPC methods are not own
// properties on the underlying target; they're synthesized on-demand
// by CF's stub proxy. So `Reflect.get(target, 'someMethod')` returns
// undefined, even though `target.someMethod(args)` works at call-time.
function instrumentRpcMethod(
	stub: DurableObjectStub,
	nsName: string,
	methodName: string,
): (...args: unknown[]) => unknown {
	return (...argArray: unknown[]) => {
		const tracer = trace.getTracer('@microlabs/otel-cf-workers')
		const attrs = {
			'do.namespace': nsName,
			'do.id': stub.id.toString(),
			'do.id.name': stub.id.name,
			'rpc.system': 'cloudflare-do',
			'rpc.service': nsName,
			'rpc.method': methodName,
		}
		return tracer.startActiveSpan(
			`Durable Object RPC ${nsName}.${methodName}`,
			{ kind: SpanKind.CLIENT, attributes: attrs },
			async (span) => {
				try {
					// Resolve the method on the underlying stub at call-time —
					// CF's stub proxy synthesizes RPC method functions on
					// access, so we must read it now, not at outer-proxy `get`.
					const fn = (stub as unknown as Record<string, unknown>)[methodName]
					if (typeof fn !== 'function') {
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: `RPC method "${methodName}" is not a function on stub`,
						})
						span.end()
						throw new TypeError(
							`Durable Object stub for namespace "${nsName}" has no callable RPC method "${methodName}"`,
						)
					}
					const result = (fn as (...a: unknown[]) => unknown).apply(stub, argArray)
					const awaited = result instanceof Promise ? await result : result
					span.setStatus({ code: SpanStatusCode.OK })
					span.end()
					return awaited
				} catch (error) {
					span.recordException(error as Exception)
					span.setStatus({ code: SpanStatusCode.ERROR })
					span.end()
					throw error
				}
			},
		)
	}
}

function instrumentBindingStub(stub: DurableObjectStub, nsName: string): DurableObjectStub {
	const stubHandler: ProxyHandler<typeof stub> = {
		get(target, prop, receiver) {
			// DEBUG instrumentation: trace every property access on a wrapped stub.
			// Helps diagnose whether the wrap is even consulted for RPC calls.
			if (typeof prop === 'string' && !STUB_NON_RPC_PROPS.has(prop) && prop !== 'fetch') {
				try {
					trace.getTracer('@microlabs/otel-cf-workers')
						.startSpan(`stub-trap.${nsName}.${prop}`, { kind: SpanKind.CLIENT })
						.end()
				} catch {
					// best-effort
				}
			}
			if (prop === 'fetch') {
				const fetcher = Reflect.get(target, prop)
				const attrs = {
					name: `Durable Object ${nsName}`,
					'do.namespace': nsName,
					'do.id': target.id.toString(),
					'do.id.name': target.id.name,
				}
				return instrumentClientFetch(fetcher, () => ({ includeTraceContext: true }), attrs)
			}
			// Non-RPC props (id, name, connect, internal symbols) pass through.
			if (typeof prop === 'symbol' || STUB_NON_RPC_PROPS.has(prop)) {
				return passthroughGet(target, prop, receiver)
			}
			// Anything else: assume user-defined RPC method (valid only on
			// class-style DOs / Worker Entrypoints). Return a wrapper that
			// resolves and dispatches the call lazily so we work with CF's
			// own-proxy stubs where the method doesn't exist as an own prop.
			return instrumentRpcMethod(target, nsName, String(prop))
		},
	}
	return wrap(stub, stubHandler)
}

function instrumentBindingGet(getFn: DurableObjectNamespace['get'], nsName: string): DurableObjectNamespace['get'] {
	const getHandler: ProxyHandler<DurableObjectNamespace['get']> = {
		apply(target, thisArg, argArray) {
			const stub: DurableObjectStub = Reflect.apply(target, thisArg, argArray)
			return instrumentBindingStub(stub, nsName)
		},
	}
	return wrap(getFn, getHandler)
}

export function instrumentDOBinding(ns: DurableObjectNamespace, nsName: string) {
	const nsHandler: ProxyHandler<typeof ns> = {
		get(target, prop, receiver) {
			if (prop === 'get') {
				const fn = Reflect.get(ns, prop, receiver)
				return instrumentBindingGet(fn, nsName)
			} else {
				return passthroughGet(target, prop, receiver)
			}
		},
	}
	return wrap(ns, nsHandler)
}

export function instrumentState(state: DurableObjectState) {
	const stateHandler: ProxyHandler<DurableObjectState> = {
		get(target, prop, receiver) {
			const result = Reflect.get(target, prop, unwrap(receiver))
			if (prop === 'storage') {
				return instrumentStorage(result)
			} else if (typeof result === 'function') {
				return result.bind(target)
			} else {
				return result
			}
		},
	}
	return wrap(state, stateHandler)
}

let cold_start = true
export function executeDOFetch(fetchFn: FetchFn, request: Request, id: DurableObjectId): Promise<Response> {
	const spanContext = getParentContextFromHeaders(request.headers)

	const tracer = trace.getTracer('DO fetchHandler')
	const attributes = {
		[SemanticAttributes.FAAS_TRIGGER]: 'http',
		[SemanticAttributes.FAAS_COLDSTART]: cold_start,
	}
	cold_start = false
	Object.assign(attributes, gatherRequestAttributes(request))
	Object.assign(attributes, gatherIncomingCfAttributes(request))
	const options: SpanOptions = {
		attributes,
		kind: SpanKind.SERVER,
	}

	const name = id.name || ''
	const promise = tracer.startActiveSpan(`Durable Object Fetch ${name}`, options, spanContext, async (span) => {
		try {
			const response: Response = await fetchFn(request)
			if (response.ok) {
				span.setStatus({ code: SpanStatusCode.OK })
			}
			span.setAttributes(gatherResponseAttributes(response))
			span.end()

			return response
		} catch (error) {
			span.recordException(error as Exception)
			span.setStatus({ code: SpanStatusCode.ERROR })
			span.end()
			throw error
		}
	})
	return promise
}

export function executeDOAlarm(alarmFn: NonNullable<AlarmFn>, id: DurableObjectId): Promise<void> {
	const tracer = trace.getTracer('DO alarmHandler')

	const name = id.name || ''
	const promise = tracer.startActiveSpan(`Durable Object Alarm ${name}`, async (span) => {
		span.setAttribute(SemanticAttributes.FAAS_COLDSTART, cold_start)
		cold_start = false
		span.setAttribute('do.id', id.toString())
		if (id.name) span.setAttribute('do.name', id.name)

		try {
			await alarmFn()
			span.end()
		} catch (error) {
			span.recordException(error as Exception)
			span.setStatus({ code: SpanStatusCode.ERROR })
			span.end()
			throw error
		}
	})
	return promise
}

function instrumentFetchFn(fetchFn: FetchFn, initialiser: Initialiser, env: Env, id: DurableObjectId): FetchFn {
	const fetchHandler: ProxyHandler<FetchFn> = {
		async apply(target, thisArg, argArray: Parameters<FetchFn>) {
			const request = argArray[0]
			const config = initialiser(env, request)
			const context = setConfig(config)
			try {
				const bound = target.bind(unwrap(thisArg))
				return await api_context.with(context, executeDOFetch, undefined, bound, request, id)
			} catch (error) {
				throw error
			}
		},
	}
	return wrap(fetchFn, fetchHandler)
}

function instrumentAlarmFn(alarmFn: AlarmFn, initialiser: Initialiser, env: Env, id: DurableObjectId) {
	if (!alarmFn) return undefined

	const alarmHandler: ProxyHandler<NonNullable<AlarmFn>> = {
		async apply(target, thisArg) {
			const config = initialiser(env, 'do-alarm')
			const context = setConfig(config)
			try {
				const bound = target.bind(unwrap(thisArg))
				return await api_context.with(context, executeDOAlarm, undefined, bound, id)
			} catch (error) {
				throw error
			}
		},
	}
	return wrap(alarmFn, alarmHandler)
}

function instrumentAnyFn(fn: () => any, initialiser: Initialiser, env: Env, _id: DurableObjectId) {
	if (!fn) return undefined

	const fnHandler: ProxyHandler<() => any> = {
		async apply(target, thisArg, argArray: []) {
			thisArg = unwrap(thisArg)
			const config = initialiser(env, 'do-alarm')
			const context = setConfig(config)
			try {
				const bound = target.bind(unwrap(thisArg))
				return await api_context.with(context, () => bound.apply(thisArg, argArray), undefined)
			} catch (error) {
				throw error
			}
		},
	}
	return wrap(fn, fnHandler)
}

function instrumentDurableObject(
	doObj: DO,
	initialiser: Initialiser,
	env: Env,
	state: DurableObjectState,
	classStyle: boolean,
) {
	const objHandler: ProxyHandler<DurableObject> = {
		get(target, prop) {
			if (classStyle && prop === 'ctx') {
				return state
			} else if (classStyle && prop === 'env') {
				return env
			} else if (prop === 'fetch') {
				const fetchFn = Reflect.get(target, prop)
				return instrumentFetchFn(fetchFn, initialiser, env, state.id)
			} else if (prop === 'alarm') {
				const alarmFn = Reflect.get(target, prop)
				return instrumentAlarmFn(alarmFn, initialiser, env, state.id)
			} else {
				const result = Reflect.get(target, prop)
				if (typeof result === 'function') {
					result.bind(doObj)
					return instrumentAnyFn(result, initialiser, env, state.id)
				}
				return result
			}
		},
	}
	return wrap(doObj, objHandler)
}

export type DOClass = { new (state: DurableObjectState, env: any): DO }

export function instrumentDOClass<C extends DOClass>(doClass: C, initialiser: Initialiser): C {
	const classHandler: ProxyHandler<C> = {
		construct(target, [orig_state, orig_env]: ConstructorParameters<DOClass>) {
			const trigger: DOConstructorTrigger = {
				id: orig_state.id.toString(),
				name: orig_state.id.name,
			}
			const constructorConfig = initialiser(orig_env, trigger)
			const context = setConfig(constructorConfig)
			const state = instrumentState(orig_state)
			const env = instrumentEnv(orig_env)
			const classStyle = doClass.prototype instanceof DurableObjectClass
			const createDO = () => {
				if (classStyle) {
					return new target(orig_state, orig_env)
				} else {
					return new target(state, env)
				}
			}
			const doObj = api_context.with(context, createDO)

			return instrumentDurableObject(doObj, initialiser, env, state, classStyle)
		},
	}
	return wrap(doClass, classHandler)
}
