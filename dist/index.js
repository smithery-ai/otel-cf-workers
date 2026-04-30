// src/buffer.ts
import { Buffer } from "node:buffer";
globalThis.Buffer = Buffer;

// src/sampling.ts
import { TraceFlags, SpanStatusCode } from "@opentelemetry/api";
import { ParentBasedSampler, TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace-base";
function multiTailSampler(samplers) {
  return (traceInfo) => {
    return samplers.reduce((result, sampler) => result || sampler(traceInfo), false);
  };
}
var isHeadSampled = (traceInfo) => {
  const localRootSpan = traceInfo.localRootSpan;
  return (localRootSpan.spanContext().traceFlags & TraceFlags.SAMPLED) === TraceFlags.SAMPLED;
};
var isRootErrorSpan = (traceInfo) => {
  const localRootSpan = traceInfo.localRootSpan;
  return localRootSpan.status.code === SpanStatusCode.ERROR;
};
function createSampler(conf) {
  const ratioSampler = new TraceIdRatioBasedSampler(conf.ratio);
  if (typeof conf.acceptRemote === "boolean" && !conf.acceptRemote) {
    return new ParentBasedSampler({
      root: ratioSampler,
      remoteParentSampled: ratioSampler,
      remoteParentNotSampled: ratioSampler
    });
  } else {
    return new ParentBasedSampler({ root: ratioSampler });
  }
}

// src/sdk.ts
import { context as api_context4, propagation as propagation2, SpanStatusCode as SpanStatusCode6, trace as trace12 } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";

// src/config.ts
import { context } from "@opentelemetry/api";

// src/types.ts
function isSpanProcessorConfig(config) {
  return !!config.spanProcessors;
}

// src/config.ts
import { W3CTraceContextPropagator } from "@opentelemetry/core";

// src/exporter.ts
import { ExportResultCode } from "@opentelemetry/core";
import { OTLPExporterError } from "@opentelemetry/otlp-exporter-base";
import { JsonTraceSerializer } from "@opentelemetry/otlp-transformer";

// src/wrap.ts
var unwrapSymbol = Symbol("unwrap");
function isWrapped(item) {
  return item && !!item[unwrapSymbol];
}
function isProxyable(item) {
  return item !== null && typeof item === "object" || typeof item === "function";
}
function wrap(item, handler, autoPassthrough = true) {
  if (isWrapped(item) || !isProxyable(item)) {
    return item;
  }
  const proxyHandler = Object.assign({}, handler);
  proxyHandler.get = (target, prop, receiver) => {
    if (prop === unwrapSymbol) {
      return item;
    } else {
      if (handler.get) {
        return handler.get(target, prop, receiver);
      } else if (prop === "bind") {
        return (thisArg, ...boundArgs) => (...callArgs) => Reflect.apply(receiver, thisArg, [...boundArgs, ...callArgs]);
      } else if (autoPassthrough) {
        return passthroughGet(target, prop);
      }
    }
  };
  proxyHandler.apply = (target, thisArg, argArray) => {
    if (handler.apply) {
      return handler.apply(unwrap(target), unwrap(thisArg), argArray);
    }
  };
  return new Proxy(item, proxyHandler);
}
function unwrap(item) {
  if (item && isWrapped(item)) {
    return item[unwrapSymbol];
  } else {
    return item;
  }
}
function passthroughGet(target, prop, thisArg) {
  const unwrappedTarget = unwrap(target);
  thisArg = unwrap(thisArg) || unwrappedTarget;
  const value = Reflect.get(unwrappedTarget, prop);
  if (typeof value === "function") {
    if (value.constructor.name === "RpcProperty") {
      return (...args) => unwrappedTarget[prop](...args);
    }
    return value.bind(thisArg);
  } else {
    return value;
  }
}

// versions.json
var _microlabs_otel_cf_workers = "1.0.0";
var node = "22.17.0";

// src/exporter.ts
var defaultHeaders = {
  accept: "application/json",
  "content-type": "application/json",
  "user-agent": `Cloudflare Worker @microlabs/otel-cf-workers v${_microlabs_otel_cf_workers}`
};
var OTLPExporter = class {
  headers;
  url;
  constructor(config) {
    this.url = config.url;
    this.headers = Object.assign({}, defaultHeaders, config.headers);
  }
  export(items, resultCallback) {
    this._export(items).then(() => {
      resultCallback({ code: ExportResultCode.SUCCESS });
    }).catch((error) => {
      resultCallback({ code: ExportResultCode.FAILED, error });
    });
  }
  _export(items) {
    return new Promise((resolve, reject) => {
      try {
        this.send(items, resolve, reject);
      } catch (e) {
        reject(e);
      }
    });
  }
  send(items, onSuccess, onError) {
    const decoder = new TextDecoder();
    const exportMessage = JsonTraceSerializer.serializeRequest(items);
    const body = decoder.decode(exportMessage);
    const params = {
      method: "POST",
      headers: this.headers,
      body
    };
    unwrap(fetch)(this.url, params).then((response) => {
      if (response.ok) {
        onSuccess();
      } else {
        onError(new OTLPExporterError(`Exporter received a statusCode: ${response.status}`));
      }
    }).catch((error) => {
      onError(new OTLPExporterError(`Exception during export: ${error.toString()}`, error.code, error.stack));
    });
  }
  async shutdown() {
  }
};

// src/spanprocessor.ts
import { ExportResultCode as ExportResultCode2 } from "@opentelemetry/core";
function getSampler() {
  const conf = getActiveConfig();
  if (!conf) {
    console.log("Could not find config for sampling, sending everything by default");
  }
  return conf ? conf.sampling.tailSampler : () => true;
}
var TraceState = class {
  unexportedSpans = [];
  inprogressSpans = /* @__PURE__ */ new Set();
  exporter;
  exportPromises = [];
  localRootSpan;
  traceDecision;
  constructor(exporter) {
    this.exporter = exporter;
  }
  addSpan(span) {
    const readableSpan = span;
    this.localRootSpan = this.localRootSpan || readableSpan;
    this.unexportedSpans.push(readableSpan);
    this.inprogressSpans.add(span.spanContext().spanId);
  }
  endSpan(span) {
    this.inprogressSpans.delete(span.spanContext().spanId);
    if (this.inprogressSpans.size === 0) {
      this.flush();
    }
  }
  sample() {
    if (this.traceDecision === void 0 && this.unexportedSpans.length > 0) {
      const sampler = getSampler();
      this.traceDecision = sampler({
        traceId: this.localRootSpan.spanContext().traceId,
        localRootSpan: this.localRootSpan,
        spans: this.unexportedSpans
      });
    }
    this.unexportedSpans = this.traceDecision ? this.unexportedSpans : [];
  }
  async flush() {
    if (this.unexportedSpans.length > 0) {
      const unfinishedSpans = this.unexportedSpans.filter((span) => this.isSpanInProgress(span));
      for (const span of unfinishedSpans) {
        console.log(`Span ${span.spanContext().spanId} was not ended properly`);
        span.end();
      }
      this.sample();
      this.exportPromises.push(this.exportSpans(this.unexportedSpans));
      this.unexportedSpans = [];
    }
    if (this.exportPromises.length > 0) {
      await Promise.allSettled(this.exportPromises);
    }
  }
  isSpanInProgress(span) {
    return this.inprogressSpans.has(span.spanContext().spanId);
  }
  async exportSpans(spans) {
    await scheduler.wait(1);
    const promise = new Promise((resolve, reject) => {
      this.exporter.export(spans, (result) => {
        if (result.code === ExportResultCode2.SUCCESS) {
          resolve();
        } else {
          console.log("exporting spans failed! " + result.error);
          reject(result.error);
        }
      });
    });
    await promise;
  }
};
var BatchTraceSpanProcessor = class {
  constructor(exporter) {
    this.exporter = exporter;
  }
  traces = {};
  getTraceState(traceId) {
    const traceState = this.traces[traceId] || new TraceState(this.exporter);
    this.traces[traceId] = traceState;
    return traceState;
  }
  onStart(span, _parentContext) {
    const traceId = span.spanContext().traceId;
    this.getTraceState(traceId).addSpan(span);
  }
  onEnd(span) {
    const traceId = span.spanContext().traceId;
    this.getTraceState(traceId).endSpan(span);
  }
  async forceFlush(traceId) {
    if (traceId) {
      await this.getTraceState(traceId).flush();
    } else {
      const promises = Object.values(this.traces).map((traceState) => traceState.flush);
      await Promise.allSettled(promises);
    }
  }
  async shutdown() {
    await this.forceFlush();
  }
};

// src/config.ts
var configSymbol = Symbol("Otel Workers Tracing Configuration");
function setConfig(config, ctx = context.active()) {
  return ctx.setValue(configSymbol, config);
}
function getActiveConfig() {
  const config = context.active().getValue(configSymbol);
  return config || void 0;
}
function isSpanExporter(exporterConfig) {
  return !!exporterConfig.export;
}
function isSampler(sampler) {
  return !!sampler.shouldSample;
}
function parseConfig(supplied) {
  if (isSpanProcessorConfig(supplied)) {
    const headSampleConf = supplied.sampling?.headSampler || { ratio: 1 };
    const headSampler = isSampler(headSampleConf) ? headSampleConf : createSampler(headSampleConf);
    const spanProcessors = Array.isArray(supplied.spanProcessors) ? supplied.spanProcessors : [supplied.spanProcessors];
    if (spanProcessors.length === 0) {
      console.log(
        "Warning! You must either specify an exporter or your own SpanProcessor(s)/Exporter combination in the open-telemetry configuration."
      );
    }
    return {
      fetch: {
        includeTraceContext: supplied.fetch?.includeTraceContext ?? true
      },
      handlers: {
        fetch: {
          acceptTraceContext: supplied.handlers?.fetch?.acceptTraceContext ?? true
        }
      },
      postProcessor: supplied.postProcessor || ((spans) => spans),
      sampling: {
        headSampler,
        tailSampler: supplied.sampling?.tailSampler || multiTailSampler([isHeadSampled, isRootErrorSpan])
      },
      service: supplied.service,
      spanProcessors,
      propagator: supplied.propagator || new W3CTraceContextPropagator(),
      instrumentation: {
        instrumentGlobalCache: supplied.instrumentation?.instrumentGlobalCache ?? true,
        instrumentGlobalFetch: supplied.instrumentation?.instrumentGlobalFetch ?? true
      }
    };
  } else {
    const exporter = isSpanExporter(supplied.exporter) ? supplied.exporter : new OTLPExporter(supplied.exporter);
    const spanProcessors = [new BatchTraceSpanProcessor(exporter)];
    const newConfig = Object.assign(supplied, { exporter: void 0, spanProcessors });
    return parseConfig(newConfig);
  }
}

// src/provider.ts
import { context as context2, trace as trace2 } from "@opentelemetry/api";

// src/context.ts
import { ROOT_CONTEXT } from "@opentelemetry/api";
import { AsyncLocalStorage } from "node:async_hooks";
import { EventEmitter } from "node:events";
var ADD_LISTENER_METHODS = [
  "addListener",
  "on",
  "once",
  "prependListener",
  "prependOnceListener"
];
var AbstractAsyncHooksContextManager = class {
  /**
   * Binds a the certain context or the active one to the target function and then returns the target
   * @param context A context (span) to be bind to target
   * @param target a function or event emitter. When target or one of its callbacks is called,
   *  the provided context will be used as the active context for the duration of the call.
   */
  bind(context3, target) {
    if (target instanceof EventEmitter) {
      return this._bindEventEmitter(context3, target);
    }
    if (typeof target === "function") {
      return this._bindFunction(context3, target);
    }
    return target;
  }
  _bindFunction(context3, target) {
    const manager = this;
    const contextWrapper = function(...args) {
      return manager.with(context3, () => target.apply(this, args));
    };
    Object.defineProperty(contextWrapper, "length", {
      enumerable: false,
      configurable: true,
      writable: false,
      value: target.length
    });
    return contextWrapper;
  }
  /**
   * By default, EventEmitter call their callback with their context, which we do
   * not want, instead we will bind a specific context to all callbacks that
   * go through it.
   * @param context the context we want to bind
   * @param ee EventEmitter an instance of EventEmitter to patch
   */
  _bindEventEmitter(context3, ee) {
    const map = this._getPatchMap(ee);
    if (map !== void 0) return ee;
    this._createPatchMap(ee);
    ADD_LISTENER_METHODS.forEach((methodName) => {
      if (ee[methodName] === void 0) return;
      ee[methodName] = this._patchAddListener(ee, ee[methodName], context3);
    });
    if (typeof ee.removeListener === "function") {
      ee.removeListener = this._patchRemoveListener(ee, ee.removeListener);
    }
    if (typeof ee.off === "function") {
      ee.off = this._patchRemoveListener(ee, ee.off);
    }
    if (typeof ee.removeAllListeners === "function") {
      ee.removeAllListeners = this._patchRemoveAllListeners(ee, ee.removeAllListeners);
    }
    return ee;
  }
  /**
   * Patch methods that remove a given listener so that we match the "patched"
   * version of that listener (the one that propagate context).
   * @param ee EventEmitter instance
   * @param original reference to the patched method
   */
  _patchRemoveListener(ee, original) {
    const contextManager = this;
    return function(event, listener) {
      const events = contextManager._getPatchMap(ee)?.[event];
      if (events === void 0) {
        return original.call(this, event, listener);
      }
      const patchedListener = events.get(listener);
      return original.call(this, event, patchedListener || listener);
    };
  }
  /**
   * Patch methods that remove all listeners so we remove our
   * internal references for a given event.
   * @param ee EventEmitter instance
   * @param original reference to the patched method
   */
  _patchRemoveAllListeners(ee, original) {
    const contextManager = this;
    return function(event) {
      const map = contextManager._getPatchMap(ee);
      if (map !== void 0) {
        if (arguments.length === 0) {
          contextManager._createPatchMap(ee);
        } else if (map[event] !== void 0) {
          delete map[event];
        }
      }
      return original.apply(this, arguments);
    };
  }
  /**
   * Patch methods on an event emitter instance that can add listeners so we
   * can force them to propagate a given context.
   * @param ee EventEmitter instance
   * @param original reference to the patched method
   * @param [context] context to propagate when calling listeners
   */
  _patchAddListener(ee, original, context3) {
    const contextManager = this;
    return function(event, listener) {
      if (contextManager._wrapped) {
        return original.call(this, event, listener);
      }
      let map = contextManager._getPatchMap(ee);
      if (map === void 0) {
        map = contextManager._createPatchMap(ee);
      }
      let listeners = map[event];
      if (listeners === void 0) {
        listeners = /* @__PURE__ */ new WeakMap();
        map[event] = listeners;
      }
      const patchedListener = contextManager.bind(context3, listener);
      listeners.set(listener, patchedListener);
      contextManager._wrapped = true;
      try {
        return original.call(this, event, patchedListener);
      } finally {
        contextManager._wrapped = false;
      }
    };
  }
  _createPatchMap(ee) {
    const map = /* @__PURE__ */ Object.create(null);
    ee[this._kOtListeners] = map;
    return map;
  }
  _getPatchMap(ee) {
    return ee[this._kOtListeners];
  }
  _kOtListeners = Symbol("OtListeners");
  _wrapped = false;
};
var AsyncLocalStorageContextManager = class extends AbstractAsyncHooksContextManager {
  _asyncLocalStorage;
  constructor() {
    super();
    this._asyncLocalStorage = new AsyncLocalStorage();
  }
  active() {
    return this._asyncLocalStorage.getStore() ?? ROOT_CONTEXT;
  }
  with(context3, fn, thisArg, ...args) {
    const cb = thisArg == null ? fn : fn.bind(thisArg);
    return this._asyncLocalStorage.run(context3, cb, ...args);
  }
  enable() {
    return this;
  }
  disable() {
    this._asyncLocalStorage.disable();
    return this;
  }
};

// src/tracer.ts
import {
  TraceFlags as TraceFlags2,
  SpanKind as SpanKind2,
  context as api_context,
  trace
} from "@opentelemetry/api";
import { sanitizeAttributes as sanitizeAttributes2 } from "@opentelemetry/core";
import { RandomIdGenerator, SamplingDecision } from "@opentelemetry/sdk-trace-base";

// src/span.ts
import {
  SpanKind,
  SpanStatusCode as SpanStatusCode2
} from "@opentelemetry/api";
import {
  hrTimeDuration,
  isAttributeValue,
  isTimeInput,
  sanitizeAttributes
} from "@opentelemetry/core";
import { SemanticAttributes } from "@opentelemetry/semantic-conventions";
function transformExceptionAttributes(exception) {
  const attributes = {};
  if (typeof exception === "string") {
    attributes[SemanticAttributes.EXCEPTION_MESSAGE] = exception;
  } else {
    if (exception.code) {
      attributes[SemanticAttributes.EXCEPTION_TYPE] = exception.code.toString();
    } else if (exception.name) {
      attributes[SemanticAttributes.EXCEPTION_TYPE] = exception.name;
    }
    if (exception.message) {
      attributes[SemanticAttributes.EXCEPTION_MESSAGE] = exception.message;
    }
    if (exception.stack) {
      attributes[SemanticAttributes.EXCEPTION_STACKTRACE] = exception.stack;
    }
  }
  return attributes;
}
function millisToHr(millis) {
  return [Math.trunc(millis / 1e3), millis % 1e3 * 1e6];
}
function getHrTime(input) {
  const now = Date.now();
  if (!input) {
    return millisToHr(now);
  } else if (input instanceof Date) {
    return millisToHr(input.getTime());
  } else if (typeof input === "number") {
    return millisToHr(input);
  } else if (Array.isArray(input)) {
    return input;
  }
  const v = input;
  throw new Error(`unreachable value: ${JSON.stringify(v)}`);
}
function isAttributeKey(key) {
  return typeof key === "string" && key.length > 0;
}
var SpanImpl = class {
  name;
  _spanContext;
  onEnd;
  parentSpanId;
  parentSpanContext;
  kind;
  attributes;
  status = {
    code: SpanStatusCode2.UNSET
  };
  endTime = [0, 0];
  _duration = [0, 0];
  startTime;
  events = [];
  links;
  resource;
  instrumentationScope = { name: "@microlabs/otel-cf-workers" };
  _ended = false;
  _droppedAttributesCount = 0;
  _droppedEventsCount = 0;
  _droppedLinksCount = 0;
  constructor(init2) {
    this.name = init2.name;
    this._spanContext = init2.spanContext;
    this.parentSpanId = init2.parentSpanId;
    this.parentSpanContext = init2.parentSpanContext;
    this.kind = init2.spanKind || SpanKind.INTERNAL;
    this.attributes = sanitizeAttributes(init2.attributes);
    this.startTime = getHrTime(init2.startTime);
    this.links = init2.links || [];
    this.resource = init2.resource;
    this.onEnd = init2.onEnd;
  }
  addLink(link) {
    this.links.push(link);
    return this;
  }
  addLinks(links) {
    this.links.push(...links);
    return this;
  }
  spanContext() {
    return this._spanContext;
  }
  setAttribute(key, value) {
    if (isAttributeKey(key) && isAttributeValue(value)) {
      this.attributes[key] = value;
    }
    return this;
  }
  setAttributes(attributes) {
    for (const [key, value] of Object.entries(attributes)) {
      this.setAttribute(key, value);
    }
    return this;
  }
  addEvent(name, attributesOrStartTime, startTime) {
    if (isTimeInput(attributesOrStartTime)) {
      startTime = attributesOrStartTime;
      attributesOrStartTime = void 0;
    }
    const attributes = sanitizeAttributes(attributesOrStartTime);
    const time = getHrTime(startTime);
    this.events.push({ name, attributes, time });
    return this;
  }
  setStatus(status) {
    this.status = status;
    return this;
  }
  updateName(name) {
    this.name = name;
    return this;
  }
  end(endTime) {
    if (this._ended) {
      return;
    }
    this._ended = true;
    this.endTime = getHrTime(endTime);
    this._duration = hrTimeDuration(this.startTime, this.endTime);
    this.onEnd(this);
  }
  isRecording() {
    return !this._ended;
  }
  recordException(exception, time) {
    const attributes = transformExceptionAttributes(exception);
    this.addEvent("exception", attributes, time);
  }
  get duration() {
    return this._duration;
  }
  get ended() {
    return this._ended;
  }
  get droppedAttributesCount() {
    return this._droppedAttributesCount;
  }
  get droppedEventsCount() {
    return this._droppedEventsCount;
  }
  get droppedLinksCount() {
    return this._droppedLinksCount;
  }
};

// src/tracer.ts
var idGenerator = new RandomIdGenerator();
var withNextSpanAttributes;
function getFlagAt(flagSequence, position) {
  return (flagSequence >> position - 1 & 1) * position;
}
var WorkerTracer = class {
  spanProcessors;
  resource;
  constructor(spanProcessors, resource) {
    this.spanProcessors = spanProcessors;
    this.resource = resource;
  }
  async forceFlush(traceId) {
    const promises = this.spanProcessors.map(async (spanProcessor) => {
      await spanProcessor.forceFlush(traceId);
    });
    await Promise.allSettled(promises);
  }
  addToResource(extra) {
    this.resource.merge(extra);
  }
  startSpan(name, options = {}, context3 = api_context.active()) {
    if (options.root) {
      context3 = trace.deleteSpan(context3);
    }
    const config = getActiveConfig();
    if (!config) throw new Error("Config is undefined. This is a bug in the instrumentation logic");
    const parentSpanContext = trace.getSpan(context3)?.spanContext();
    const { traceId, randomTraceFlag } = getTraceInfo(parentSpanContext);
    const spanKind = options.kind || SpanKind2.INTERNAL;
    const sanitisedAttrs = sanitizeAttributes2(options.attributes);
    const sampler = config.sampling.headSampler;
    const samplingDecision = sampler.shouldSample(context3, traceId, name, spanKind, sanitisedAttrs, []);
    const { decision, traceState, attributes: attrs } = samplingDecision;
    const attributes = Object.assign({}, options.attributes, attrs, withNextSpanAttributes);
    withNextSpanAttributes = {};
    const spanId = idGenerator.generateSpanId();
    const parentSpanId = parentSpanContext?.spanId;
    const sampleFlag = decision === SamplingDecision.RECORD_AND_SAMPLED ? TraceFlags2.SAMPLED : TraceFlags2.NONE;
    const traceFlags = sampleFlag + randomTraceFlag;
    const spanContext = { traceId, spanId, traceFlags, traceState };
    const span = new SpanImpl({
      attributes: sanitizeAttributes2(attributes),
      name,
      onEnd: (span2) => {
        this.spanProcessors.forEach((sp) => {
          sp.onEnd(span2);
        });
      },
      resource: this.resource,
      spanContext,
      parentSpanContext,
      parentSpanId,
      spanKind,
      startTime: options.startTime
    });
    this.spanProcessors.forEach((sp) => {
      sp.onStart(span, context3);
    });
    return span;
  }
  startActiveSpan(name, ...args) {
    const options = args.length > 1 ? args[0] : void 0;
    const parentContext = args.length > 2 ? args[1] : api_context.active();
    const fn = args[args.length - 1];
    const span = this.startSpan(name, options, parentContext);
    const contextWithSpanSet = trace.setSpan(parentContext, span);
    return api_context.with(contextWithSpanSet, fn, void 0, span);
  }
};
function withNextSpan(attrs) {
  withNextSpanAttributes = Object.assign({}, withNextSpanAttributes, attrs);
}
function getTraceInfo(parentSpanContext) {
  if (parentSpanContext && trace.isSpanContextValid(parentSpanContext)) {
    const { traceId, traceFlags } = parentSpanContext;
    return { traceId, randomTraceFlag: getFlagAt(traceFlags, 2) };
  } else {
    return { traceId: idGenerator.generateTraceId(), randomTraceFlag: 2 /* RANDOM_TRACE_ID_SET */ };
  }
}

// src/provider.ts
var WorkerTracerProvider = class {
  spanProcessors;
  resource;
  tracers = {};
  constructor(spanProcessors, resource) {
    this.spanProcessors = spanProcessors;
    this.resource = resource;
  }
  getTracer(name, version, options) {
    const key = `${name}@${version || ""}:${options?.schemaUrl || ""}`;
    if (!this.tracers[key]) {
      this.tracers[key] = new WorkerTracer(this.spanProcessors, this.resource);
    }
    return this.tracers[key];
  }
  register() {
    trace2.setGlobalTracerProvider(this);
    context2.setGlobalContextManager(new AsyncLocalStorageContextManager());
  }
};

// src/instrumentation/fetch.ts
import {
  trace as trace3,
  SpanKind as SpanKind3,
  propagation,
  context as api_context2,
  SpanStatusCode as SpanStatusCode3
} from "@opentelemetry/api";
var netKeysFromCF = /* @__PURE__ */ new Set(["colo", "country", "request_priority", "tls_cipher", "tls_version", "asn", "tcp_rtt"]);
var camelToSnakeCase = (s) => {
  return s.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
};
var gatherOutgoingCfAttributes = (cf) => {
  const attrs = {};
  Object.keys(cf).forEach((key) => {
    const value = cf[key];
    const destKey = camelToSnakeCase(key);
    if (!netKeysFromCF.has(destKey)) {
      if (typeof value === "string" || typeof value === "number") {
        attrs[`cf.${destKey}`] = value;
      } else {
        attrs[`cf.${destKey}`] = JSON.stringify(value);
      }
    }
  });
  return attrs;
};
function gatherRequestAttributes(request) {
  const attrs = {};
  const headers = request.headers;
  attrs["http.request.method"] = request.method.toUpperCase();
  attrs["network.protocol.name"] = "http";
  attrs["network.protocol.version"] = request.cf?.httpProtocol;
  attrs["http.request.body.size"] = headers.get("content-length");
  attrs["user_agent.original"] = headers.get("user-agent");
  attrs["http.mime_type"] = headers.get("content-type");
  attrs["http.accepts"] = request.cf?.clientAcceptEncoding;
  const u = new URL(request.url);
  attrs["url.full"] = `${u.protocol}//${u.host}${u.pathname}${u.search}`;
  attrs["server.address"] = u.host;
  attrs["url.scheme"] = u.protocol;
  attrs["url.path"] = u.pathname;
  attrs["url.query"] = u.search;
  return attrs;
}
function gatherResponseAttributes(response) {
  const attrs = {};
  attrs["http.response.status_code"] = response.status;
  if (response.headers.get("content-length") == null) {
    attrs["http.response.body.size"] = response.headers.get("content-length");
  }
  attrs["http.mime_type"] = response.headers.get("content-type");
  return attrs;
}
function gatherIncomingCfAttributes(request) {
  const attrs = {};
  attrs["net.colo"] = request.cf?.colo;
  attrs["net.country"] = request.cf?.country;
  attrs["net.request_priority"] = request.cf?.requestPriority;
  attrs["net.tls_cipher"] = request.cf?.tlsCipher;
  attrs["net.tls_version"] = request.cf?.tlsVersion;
  attrs["net.asn"] = request.cf?.asn;
  attrs["net.tcp_rtt"] = request.cf?.clientTcpRtt;
  return attrs;
}
function getParentContextFromHeaders(headers) {
  return propagation.extract(api_context2.active(), headers, {
    get(headers2, key) {
      return headers2.get(key) || void 0;
    },
    keys(headers2) {
      return [...headers2.keys()];
    }
  });
}
function getParentContextFromRequest(request) {
  const workerConfig = getActiveConfig();
  if (workerConfig === void 0) {
    return api_context2.active();
  }
  const acceptTraceContext = typeof workerConfig.handlers.fetch.acceptTraceContext === "function" ? workerConfig.handlers.fetch.acceptTraceContext(request) : workerConfig.handlers.fetch.acceptTraceContext ?? true;
  return acceptTraceContext ? getParentContextFromHeaders(request.headers) : api_context2.active();
}
function updateSpanNameOnRoute(span, request) {
  const readable = span;
  if (readable.attributes["http.route"]) {
    const method = request.method.toUpperCase();
    span.updateName(`${method} ${readable.attributes["http.route"]}`);
  }
}
var fetchInstrumentation = {
  getInitialSpanInfo: (request) => {
    const spanContext = getParentContextFromRequest(request);
    const attributes = {
      ["faas.trigger"]: "http",
      ["faas.invocation_id"]: request.headers.get("cf-ray") ?? void 0
    };
    Object.assign(attributes, gatherRequestAttributes(request));
    Object.assign(attributes, gatherIncomingCfAttributes(request));
    const method = request.method.toUpperCase();
    return {
      name: `fetchHandler ${method}`,
      options: {
        attributes,
        kind: SpanKind3.SERVER
      },
      context: spanContext
    };
  },
  getAttributesFromResult: (response) => {
    return gatherResponseAttributes(response);
  },
  executionSucces: updateSpanNameOnRoute,
  executionFailed: updateSpanNameOnRoute
};
function instrumentClientFetch(fetchFn, configFn, attrs) {
  const handler = {
    apply: (target, thisArg, argArray) => {
      const request = new Request(argArray[0], argArray[1]);
      if (!request.url.startsWith("http")) {
        return Reflect.apply(target, thisArg, argArray);
      }
      const workerConfig = getActiveConfig();
      if (!workerConfig) {
        return Reflect.apply(target, thisArg, [request]);
      }
      const config = configFn(workerConfig);
      const tracer2 = trace3.getTracer("fetcher");
      const options = { kind: SpanKind3.CLIENT, attributes: attrs };
      const host = new URL(request.url).host;
      const method = request.method.toUpperCase();
      const spanName = typeof attrs?.["name"] === "string" ? attrs?.["name"] : `fetch ${method} ${host}`;
      const promise = tracer2.startActiveSpan(spanName, options, async (span) => {
        try {
          const includeTraceContext = typeof config.includeTraceContext === "function" ? config.includeTraceContext(request) : config.includeTraceContext;
          if (includeTraceContext ?? true) {
            propagation.inject(api_context2.active(), request.headers, {
              set: (h, k, v) => h.set(k, typeof v === "string" ? v : String(v))
            });
          }
          span.setAttributes(gatherRequestAttributes(request));
          if (request.cf) span.setAttributes(gatherOutgoingCfAttributes(request.cf));
          const response = await Reflect.apply(target, thisArg, [request]);
          span.setAttributes(gatherResponseAttributes(response));
          return response;
        } catch (error) {
          span.recordException(error);
          span.setStatus({ code: SpanStatusCode3.ERROR });
          throw error;
        } finally {
          span.end();
        }
      });
      return promise;
    }
  };
  return wrap(fetchFn, handler, true);
}
function instrumentGlobalFetch() {
  globalThis.fetch = instrumentClientFetch(globalThis.fetch, (config) => config.fetch);
}

// src/instrumentation/cache.ts
import { SpanKind as SpanKind4, trace as trace4 } from "@opentelemetry/api";
var tracer = trace4.getTracer("cache instrumentation");
function sanitiseURL(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.host}${u.pathname}${u.search}`;
}
function instrumentFunction(fn, cacheName, op) {
  const handler = {
    async apply(target, thisArg, argArray) {
      const attributes = {
        "cache.name": cacheName,
        "http.url": argArray[0].url ? sanitiseURL(argArray[0].url) : void 0,
        "cache.operation": op
      };
      const options = { kind: SpanKind4.CLIENT, attributes };
      return tracer.startActiveSpan(`Cache ${cacheName} ${op}`, options, async (span) => {
        const result = await Reflect.apply(target, thisArg, argArray);
        if (op === "match") {
          span.setAttribute("cache.hit", !!result);
        }
        span.end();
        return result;
      });
    }
  };
  return wrap(fn, handler);
}
function instrumentCache(cache, cacheName) {
  const handler = {
    get(target, prop) {
      if (prop === "delete" || prop === "match" || prop === "put") {
        const fn = Reflect.get(target, prop).bind(target);
        return instrumentFunction(fn, cacheName, prop);
      } else {
        return Reflect.get(target, prop);
      }
    }
  };
  return wrap(cache, handler);
}
function instrumentOpen(openFn) {
  const handler = {
    async apply(target, thisArg, argArray) {
      const cacheName = argArray[0];
      const cache = await Reflect.apply(target, thisArg, argArray);
      return instrumentCache(cache, cacheName);
    }
  };
  return wrap(openFn, handler);
}
function _instrumentGlobalCache() {
  const handler = {
    get(target, prop) {
      if (prop === "default") {
        const cache = target.default;
        return instrumentCache(cache, "default");
      } else if (prop === "open") {
        const openFn = Reflect.get(target, prop).bind(target);
        return instrumentOpen(openFn);
      } else {
        return Reflect.get(target, prop);
      }
    }
  };
  globalThis.caches = wrap(caches, handler);
}
function instrumentGlobalCache() {
  return _instrumentGlobalCache();
}

// src/instrumentation/queue.ts
import { trace as trace5, SpanKind as SpanKind5 } from "@opentelemetry/api";
import { ATTR_FAAS_TRIGGER, FAAS_TRIGGER_VALUE_PUBSUB } from "@opentelemetry/semantic-conventions/incubating";
var MessageStatusCount = class {
  succeeded = 0;
  failed = 0;
  implicitly_acked = 0;
  implicitly_retried = 0;
  total;
  constructor(total) {
    this.total = total;
  }
  ack() {
    this.succeeded = this.succeeded + 1;
  }
  ackRemaining() {
    this.implicitly_acked = this.total - this.succeeded - this.failed;
    this.succeeded = this.total - this.failed;
  }
  retry() {
    this.failed = this.failed + 1;
  }
  retryRemaining() {
    this.implicitly_retried = this.total - this.succeeded - this.failed;
    this.failed = this.total - this.succeeded;
  }
  toAttributes() {
    return {
      "queue.messages_count": this.total,
      "queue.messages_success": this.succeeded,
      "queue.messages_failed": this.failed,
      "queue.batch_success": this.succeeded === this.total,
      "queue.implicitly_acked": this.implicitly_acked,
      "queue.implicitly_retried": this.implicitly_retried
    };
  }
};
var addEvent = (name, msg) => {
  const attrs = {};
  if (msg) {
    attrs["queue.message_id"] = msg.id;
    attrs["queue.message_timestamp"] = msg.timestamp.toISOString();
  }
  trace5.getActiveSpan()?.addEvent(name, attrs);
};
var proxyQueueMessage = (msg, count) => {
  const msgHandler = {
    get: (target, prop) => {
      if (prop === "ack") {
        const ackFn = Reflect.get(target, prop);
        return new Proxy(ackFn, {
          apply: (fnTarget) => {
            addEvent("messageAck", msg);
            count.ack();
            Reflect.apply(fnTarget, msg, []);
          }
        });
      } else if (prop === "retry") {
        const retryFn = Reflect.get(target, prop);
        return new Proxy(retryFn, {
          apply: (fnTarget) => {
            addEvent("messageRetry", msg);
            count.retry();
            const result = Reflect.apply(fnTarget, msg, []);
            return result;
          }
        });
      } else {
        return Reflect.get(target, prop, msg);
      }
    }
  };
  return wrap(msg, msgHandler);
};
var proxyMessageBatch = (batch, count) => {
  const batchHandler = {
    get: (target, prop) => {
      if (prop === "messages") {
        const messages = Reflect.get(target, prop);
        const messagesHandler = {
          get: (target2, prop2) => {
            if (typeof prop2 === "string" && !isNaN(parseInt(prop2))) {
              const message = Reflect.get(target2, prop2);
              return proxyQueueMessage(message, count);
            } else {
              return Reflect.get(target2, prop2);
            }
          }
        };
        return wrap(messages, messagesHandler);
      } else if (prop === "ackAll") {
        const ackFn = Reflect.get(target, prop);
        return new Proxy(ackFn, {
          apply: (fnTarget) => {
            addEvent("ackAll");
            count.ackRemaining();
            Reflect.apply(fnTarget, batch, []);
          }
        });
      } else if (prop === "retryAll") {
        const retryFn = Reflect.get(target, prop);
        return new Proxy(retryFn, {
          apply: (fnTarget) => {
            addEvent("retryAll");
            count.retryRemaining();
            Reflect.apply(fnTarget, batch, []);
          }
        });
      }
      return Reflect.get(target, prop);
    }
  };
  return wrap(batch, batchHandler);
};
var QueueInstrumentation = class {
  count;
  getInitialSpanInfo(batch) {
    return {
      name: `queueHandler ${batch.queue}`,
      options: {
        attributes: {
          [ATTR_FAAS_TRIGGER]: FAAS_TRIGGER_VALUE_PUBSUB,
          "queue.name": batch.queue
        },
        kind: SpanKind5.CONSUMER
      }
    };
  }
  instrumentTrigger(batch) {
    this.count = new MessageStatusCount(batch.messages.length);
    return proxyMessageBatch(batch, this.count);
  }
  executionSucces(span) {
    if (this.count) {
      this.count.ackRemaining();
      span.setAttributes(this.count.toAttributes());
    }
  }
  executionFailed(span) {
    if (this.count) {
      this.count.retryRemaining();
      span.setAttributes(this.count.toAttributes());
    }
  }
};
function instrumentQueueSend(fn, name) {
  const tracer2 = trace5.getTracer("queueSender");
  const handler = {
    apply: (target, thisArg, argArray) => {
      return tracer2.startActiveSpan(`Queues ${name} send`, async (span) => {
        span.setAttribute("queue.operation", "send");
        await Reflect.apply(target, unwrap(thisArg), argArray);
        span.end();
      });
    }
  };
  return wrap(fn, handler);
}
function instrumentQueueSendBatch(fn, name) {
  const tracer2 = trace5.getTracer("queueSender");
  const handler = {
    apply: (target, thisArg, argArray) => {
      return tracer2.startActiveSpan(`Queues ${name} sendBatch`, async (span) => {
        span.setAttribute("queue.operation", "sendBatch");
        await Reflect.apply(target, unwrap(thisArg), argArray);
        span.end();
      });
    }
  };
  return wrap(fn, handler);
}
function instrumentQueueSender(queue, name) {
  const queueHandler = {
    get: (target, prop) => {
      if (prop === "send") {
        const sendFn = Reflect.get(target, prop);
        return instrumentQueueSend(sendFn, name);
      } else if (prop === "sendBatch") {
        const sendFn = Reflect.get(target, prop);
        return instrumentQueueSendBatch(sendFn, name);
      } else {
        return Reflect.get(target, prop);
      }
    }
  };
  return wrap(queue, queueHandler);
}

// src/instrumentation/do.ts
import { context as api_context3, trace as trace10, SpanKind as SpanKind10, SpanStatusCode as SpanStatusCode5 } from "@opentelemetry/api";
import { SemanticAttributes as SemanticAttributes6 } from "@opentelemetry/semantic-conventions";

// src/instrumentation/kv.ts
import { SpanKind as SpanKind6, trace as trace6 } from "@opentelemetry/api";
import { SemanticAttributes as SemanticAttributes2 } from "@opentelemetry/semantic-conventions";
var dbSystem = "Cloudflare KV";
var KVAttributes = {
  delete(_argArray) {
    return {};
  },
  get(argArray) {
    const attrs = {};
    const opts = argArray[1];
    if (typeof opts === "string") {
      attrs["db.cf.kv.type"] = opts;
    } else if (typeof opts === "object") {
      attrs["db.cf.kv.type"] = opts.type;
      attrs["db.cf.kv.cache_ttl"] = opts.cacheTtl;
    }
    return attrs;
  },
  getWithMetadata(argArray, result) {
    const attrs = {};
    const opts = argArray[1];
    if (typeof opts === "string") {
      attrs["db.cf.kv.type"] = opts;
    } else if (typeof opts === "object") {
      attrs["db.cf.kv.type"] = opts.type;
      attrs["db.cf.kv.cache_ttl"] = opts.cacheTtl;
    }
    attrs["db.cf.kv.metadata"] = true;
    const { cacheStatus } = result;
    if (typeof cacheStatus === "string") {
      attrs["db.cf.kv.cache_status"] = cacheStatus;
    }
    return attrs;
  },
  list(argArray, result) {
    const attrs = {};
    const opts = argArray[0] || {};
    const { cursor, limit } = opts;
    attrs["db.cf.kv.list_request_cursor"] = cursor || void 0;
    attrs["db.cf.kv.list_limit"] = limit || void 0;
    const { list_complete, cacheStatus } = result;
    attrs["db.cf.kv.list_complete"] = list_complete || void 0;
    if (!list_complete) {
      attrs["db.cf.kv.list_response_cursor"] = cursor || void 0;
    }
    if (typeof cacheStatus === "string") {
      attrs["db.cf.kv.cache_status"] = cacheStatus;
    }
    return attrs;
  },
  put(argArray) {
    const attrs = {};
    if (argArray.length > 2 && argArray[2]) {
      const { expiration, expirationTtl, metadata } = argArray[2];
      attrs["db.cf.kv.expiration"] = expiration;
      attrs["db.cf.kv.expiration_ttl"] = expirationTtl;
      attrs["db.cf.kv.metadata"] = !!metadata;
    }
    return attrs;
  }
};
function instrumentKVFn(fn, name, operation) {
  const tracer2 = trace6.getTracer("KV");
  const fnHandler = {
    apply: (target, thisArg, argArray) => {
      const attributes = {
        binding_type: "KV",
        [SemanticAttributes2.DB_NAME]: name,
        [SemanticAttributes2.DB_SYSTEM]: dbSystem,
        [SemanticAttributes2.DB_OPERATION]: operation
      };
      const options = {
        kind: SpanKind6.CLIENT,
        attributes
      };
      return tracer2.startActiveSpan(`KV ${name} ${operation}`, options, async (span) => {
        const result = await Reflect.apply(target, thisArg, argArray);
        const extraAttrsFn = KVAttributes[operation];
        const extraAttrs = extraAttrsFn ? extraAttrsFn(argArray, result) : {};
        span.setAttributes(extraAttrs);
        if (operation === "list") {
          const opts = argArray[0] || {};
          const { prefix } = opts;
          span.setAttribute(SemanticAttributes2.DB_STATEMENT, `${operation} ${prefix || void 0}`);
        } else {
          span.setAttribute(SemanticAttributes2.DB_STATEMENT, `${operation} ${argArray[0]}`);
          span.setAttribute("db.cf.kv.key", argArray[0]);
        }
        if (operation === "getWithMetadata") {
          const hasResults = !!result && !!result.value;
          span.setAttribute("db.cf.kv.has_result", hasResults);
        } else {
          span.setAttribute("db.cf.kv.has_result", !!result);
        }
        span.end();
        return result;
      });
    }
  };
  return wrap(fn, fnHandler);
}
function instrumentKV(kv, name) {
  const kvHandler = {
    get: (target, prop, receiver) => {
      const operation = String(prop);
      const fn = Reflect.get(target, prop, receiver);
      return instrumentKVFn(fn, name, operation);
    }
  };
  return wrap(kv, kvHandler);
}

// src/instrumentation/service.ts
function instrumentServiceBinding(fetcher, envName) {
  const fetcherHandler = {
    get(target, prop) {
      if (prop === "fetch") {
        const fetcher2 = Reflect.get(target, prop);
        const attrs = {
          name: `Service Binding ${envName}`
        };
        return instrumentClientFetch(fetcher2, () => ({ includeTraceContext: true }), attrs);
      } else {
        return passthroughGet(target, prop);
      }
    }
  };
  return wrap(fetcher, fetcherHandler);
}

// src/instrumentation/d1.ts
import { SpanKind as SpanKind7, SpanStatusCode as SpanStatusCode4, trace as trace7 } from "@opentelemetry/api";
import { SemanticAttributes as SemanticAttributes3 } from "@opentelemetry/semantic-conventions";
var dbSystem2 = "Cloudflare D1";
function metaAttributes(meta) {
  return {
    "db.cf.d1.rows_read": meta.rows_read,
    "db.cf.d1.rows_written": meta.rows_written,
    "db.cf.d1.duration": meta.duration,
    "db.cf.d1.size_after": meta.size_after,
    "db.cf.d1.last_row_id": meta.last_row_id,
    "db.cf.d1.changed_db": meta.changed_db,
    "db.cf.d1.changes": meta.changes
  };
}
function spanOptions(dbName, operation, sql) {
  const attributes = {
    binding_type: "D1",
    [SemanticAttributes3.DB_NAME]: dbName,
    [SemanticAttributes3.DB_SYSTEM]: dbSystem2,
    [SemanticAttributes3.DB_OPERATION]: operation
  };
  if (sql) {
    attributes[SemanticAttributes3.DB_STATEMENT] = sql;
  }
  return {
    kind: SpanKind7.CLIENT,
    attributes
  };
}
function instrumentD1StatementFn(fn, dbName, operation, sql) {
  const tracer2 = trace7.getTracer("D1");
  const fnHandler = {
    apply: (target, thisArg, argArray) => {
      if (operation === "bind") {
        const newStmt = Reflect.apply(target, thisArg, argArray);
        return instrumentD1PreparedStatement(newStmt, dbName, sql);
      }
      const options = spanOptions(dbName, operation, sql);
      return tracer2.startActiveSpan(`${dbName} ${operation}`, options, async (span) => {
        try {
          const result = await Reflect.apply(target, thisArg, argArray);
          if (operation === "all" || operation === "run") {
            span.setAttributes(metaAttributes(result.meta));
          }
          span.setStatus({ code: SpanStatusCode4.OK });
          return result;
        } catch (error) {
          span.recordException(error);
          span.setStatus({ code: SpanStatusCode4.ERROR });
          throw error;
        } finally {
          span.end();
        }
      });
    }
  };
  return wrap(fn, fnHandler);
}
function instrumentD1PreparedStatement(stmt, dbName, statement) {
  const statementHandler = {
    get: (target, prop, receiver) => {
      const operation = String(prop);
      const fn = Reflect.get(target, prop, receiver);
      if (typeof fn === "function") {
        return instrumentD1StatementFn(fn, dbName, operation, statement);
      }
      return fn;
    }
  };
  return wrap(stmt, statementHandler);
}
function instrumentD1Fn(fn, dbName, operation) {
  const tracer2 = trace7.getTracer("D1");
  const fnHandler = {
    apply: (target, thisArg, argArray) => {
      if (operation === "prepare") {
        const sql = argArray[0];
        const stmt = Reflect.apply(target, thisArg, argArray);
        return instrumentD1PreparedStatement(stmt, dbName, sql);
      } else if (operation === "exec") {
        const sql = argArray[0];
        const options = spanOptions(dbName, operation, sql);
        return tracer2.startActiveSpan(`${dbName} ${operation}`, options, async (span) => {
          try {
            const result = await Reflect.apply(target, thisArg, argArray);
            span.setStatus({ code: SpanStatusCode4.OK });
            return result;
          } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode4.ERROR });
            throw error;
          } finally {
            span.end();
          }
        });
      } else if (operation === "batch") {
        const statements = argArray[0];
        return tracer2.startActiveSpan(`${dbName} ${operation}`, async (span) => {
          const subSpans = statements.map(
            (s) => tracer2.startSpan(`${dbName} ${operation} > query`, spanOptions(dbName, operation, s.statement))
          );
          try {
            const result = await Reflect.apply(target, thisArg, argArray);
            result.forEach((r, i) => subSpans[i]?.setAttributes(metaAttributes(r.meta)));
            span.setStatus({ code: SpanStatusCode4.OK });
            return result;
          } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode4.ERROR });
            throw error;
          } finally {
            subSpans.forEach((s) => s.end());
            span.end();
          }
        });
      } else {
        return Reflect.apply(target, thisArg, argArray);
      }
    }
  };
  return wrap(fn, fnHandler);
}
function instrumentD1(database, dbName) {
  const dbHandler = {
    get: (target, prop, receiver) => {
      const operation = String(prop);
      const fn = Reflect.get(target, prop, receiver);
      if (typeof fn === "function") {
        return instrumentD1Fn(fn, dbName, operation);
      }
      return fn;
    }
  };
  return wrap(database, dbHandler);
}

// src/instrumentation/analytics-engine.ts
import { SpanKind as SpanKind8, trace as trace8 } from "@opentelemetry/api";
import { SemanticAttributes as SemanticAttributes4 } from "@opentelemetry/semantic-conventions";
var dbSystem3 = "Cloudflare Analytics Engine";
var AEAttributes = {
  writeDataPoint(argArray) {
    const attrs = {};
    const opts = argArray[0];
    if (typeof opts === "object") {
      attrs["db.cf.ae.indexes"] = opts.indexes.length;
      attrs["db.cf.ae.index"] = opts.indexes[0].toString();
      attrs["db.cf.ae.doubles"] = opts.doubles.length;
      attrs["db.cf.ae.blobs"] = opts.blobs.length;
    }
    return attrs;
  }
};
function instrumentAEFn(fn, name, operation) {
  const tracer2 = trace8.getTracer("AnalyticsEngine");
  const fnHandler = {
    apply: (target, thisArg, argArray) => {
      const attributes = {
        binding_type: "AnalyticsEngine",
        [SemanticAttributes4.DB_NAME]: name,
        [SemanticAttributes4.DB_SYSTEM]: dbSystem3,
        [SemanticAttributes4.DB_OPERATION]: operation
      };
      const options = {
        kind: SpanKind8.CLIENT,
        attributes
      };
      return tracer2.startActiveSpan(`Analytics Engine ${name} ${operation}`, options, async (span) => {
        const result = await Reflect.apply(target, thisArg, argArray);
        const extraAttrsFn = AEAttributes[operation];
        const extraAttrs = extraAttrsFn ? extraAttrsFn(argArray, result) : {};
        span.setAttributes(extraAttrs);
        span.setAttribute(SemanticAttributes4.DB_STATEMENT, `${operation} ${argArray[0]}`);
        span.end();
        return result;
      });
    }
  };
  return wrap(fn, fnHandler);
}
function instrumentAnalyticsEngineDataset(dataset, name) {
  const datasetHandler = {
    get: (target, prop, receiver) => {
      const operation = String(prop);
      const fn = Reflect.get(target, prop, receiver);
      return instrumentAEFn(fn, name, operation);
    }
  };
  return wrap(dataset, datasetHandler);
}

// src/instrumentation/env.ts
var isJSRPC = (item) => {
  return !!item?.["__some_property_that_will_never_exist" + Math.random()];
};
var isKVNamespace = (item) => {
  return !isJSRPC(item) && !!item?.getWithMetadata;
};
var isQueue = (item) => {
  return !isJSRPC(item) && !!item?.sendBatch;
};
var isDurableObject = (item) => {
  return !isJSRPC(item) && !!item?.idFromName;
};
var isVersionMetadata = (item) => {
  return !isJSRPC(item) && typeof item?.id === "string" && typeof item?.tag === "string";
};
var isAnalyticsEngineDataset = (item) => {
  return !isJSRPC(item) && !!item?.writeDataPoint;
};
var isD1Database = (item) => {
  return !!item?.exec && !!item?.prepare;
};
var instrumentEnv = (env2) => {
  const envHandler = {
    get: (target, prop, receiver) => {
      const item = Reflect.get(target, prop, receiver);
      if (!isProxyable(item)) {
        return item;
      }
      if (isJSRPC(item)) {
        return instrumentServiceBinding(item, String(prop));
      } else if (isKVNamespace(item)) {
        return instrumentKV(item, String(prop));
      } else if (isQueue(item)) {
        return instrumentQueueSender(item, String(prop));
      } else if (isDurableObject(item)) {
        return instrumentDOBinding(item, String(prop));
      } else if (isVersionMetadata(item)) {
        return item;
      } else if (isAnalyticsEngineDataset(item)) {
        return instrumentAnalyticsEngineDataset(item, String(prop));
      } else if (isD1Database(item)) {
        return instrumentD1(item, String(prop));
      } else {
        return item;
      }
    }
  };
  return wrap(env2, envHandler);
};

// src/instrumentation/do-storage.ts
import { SpanKind as SpanKind9, trace as trace9 } from "@opentelemetry/api";
import { SemanticAttributes as SemanticAttributes5 } from "@opentelemetry/semantic-conventions";
var dbSystem4 = "Cloudflare DO";
function isDurableObjectCommonOptions(options) {
  return typeof options === "object" && ("allowConcurrency" in options || "allowUnconfirmed" in options || "noCache" in options);
}
function applyOptionsAttributes(attrs, options) {
  if ("allowConcurrency" in options) {
    attrs["db.cf.do.allow_concurrency"] = options.allowConcurrency;
  }
  if ("allowUnconfirmed" in options) {
    attrs["db.cf.do.allow_unconfirmed"] = options.allowUnconfirmed;
  }
  if ("noCache" in options) {
    attrs["db.cf.do.no_cache"] = options.noCache;
  }
}
var StorageAttributes = {
  delete(argArray, result) {
    const args = argArray;
    let attrs = {};
    if (Array.isArray(args[0])) {
      const keys = args[0];
      attrs = {
        // todo: Maybe set db.cf.do.keys to the whole array here?
        "db.cf.do.key": keys[0],
        "db.cf.do.number_of_keys": keys.length,
        "db.cf.do.keys_deleted": result
      };
    } else {
      attrs = {
        "db.cf.do.key": args[0],
        "db.cf.do.success": result
      };
    }
    if (args[1]) {
      applyOptionsAttributes(attrs, args[1]);
    }
    return attrs;
  },
  deleteAll(argArray) {
    const args = argArray;
    let attrs = {};
    if (args[0]) {
      applyOptionsAttributes(attrs, args[0]);
    }
    return attrs;
  },
  get(argArray) {
    const args = argArray;
    let attrs = {};
    if (Array.isArray(args[0])) {
      const keys = args[0];
      attrs = {
        // todo: Maybe set db.cf.do.keys to the whole array here?
        "db.cf.do.key": keys[0],
        "db.cf.do.number_of_keys": keys.length
      };
    } else {
      attrs = {
        "db.cf.do.key": args[0]
      };
    }
    if (args[1]) {
      applyOptionsAttributes(attrs, args[1]);
    }
    return attrs;
  },
  list(argArray, result) {
    const args = argArray;
    const attrs = {
      "db.cf.do.number_of_results": result.size
    };
    if (args[0]) {
      const options = args[0];
      applyOptionsAttributes(attrs, options);
      if ("start" in options) {
        attrs["db.cf.do.start"] = options.start;
      }
      if ("startAfter" in options) {
        attrs["db.cf.do.start_after"] = options.startAfter;
      }
      if ("end" in options) {
        attrs["db.cf.do.end"] = options.end;
      }
      if ("prefix" in options) {
        attrs["db.cf.do.prefix"] = options.prefix;
      }
      if ("reverse" in options) {
        attrs["db.cf.do.reverse"] = options.reverse;
      }
      if ("limit" in options) {
        attrs["db.cf.do.limit"] = options.limit;
      }
    }
    return attrs;
  },
  put(argArray) {
    const args = argArray;
    const attrs = {};
    if (typeof args[0] === "string") {
      attrs["db.cf.do.key"] = args[0];
      if (args[2]) {
        applyOptionsAttributes(attrs, args[2]);
      }
    } else {
      const keys = Object.keys(args[0]);
      attrs["db.cf.do.key"] = keys[0];
      attrs["db.cf.do.number_of_keys"] = keys.length;
      if (isDurableObjectCommonOptions(args[1])) {
        applyOptionsAttributes(attrs, args[1]);
      }
    }
    return attrs;
  },
  getAlarm(argArray) {
    const args = argArray;
    const attrs = {};
    if (args[0]) {
      applyOptionsAttributes(attrs, args[0]);
    }
    return attrs;
  },
  setAlarm(argArray) {
    const args = argArray;
    const attrs = {};
    if (args[0] instanceof Date) {
      attrs["db.cf.do.alarm_time"] = args[0].getTime();
    } else {
      attrs["db.cf.do.alarm_time"] = args[0];
    }
    if (args[1]) {
      applyOptionsAttributes(attrs, args[1]);
    }
    return attrs;
  },
  deleteAlarm(argArray) {
    const args = argArray;
    const attrs = {};
    if (args[0]) {
      applyOptionsAttributes(attrs, args[0]);
    }
    return attrs;
  }
};
function instrumentStorageFn(fn, operation) {
  const tracer2 = trace9.getTracer("do_storage");
  const fnHandler = {
    apply: (target, thisArg, argArray) => {
      const attributes = {
        [SemanticAttributes5.DB_SYSTEM]: dbSystem4,
        [SemanticAttributes5.DB_OPERATION]: operation,
        [SemanticAttributes5.DB_STATEMENT]: `${operation} ${argArray[0]}`
      };
      const options = {
        kind: SpanKind9.CLIENT,
        attributes: {
          ...attributes,
          operation
        }
      };
      return tracer2.startActiveSpan(`Durable Object Storage ${operation}`, options, async (span) => {
        const result = await Reflect.apply(target, thisArg, argArray);
        const extraAttrsFn = StorageAttributes[operation];
        const extraAttrs = extraAttrsFn ? extraAttrsFn(argArray, result) : {};
        span.setAttributes(extraAttrs);
        span.setAttribute("db.cf.do.has_result", !!result);
        span.end();
        return result;
      });
    }
  };
  return wrap(fn, fnHandler);
}
function instrumentStorage(storage) {
  const storageHandler = {
    get: (target, prop, receiver) => {
      const operation = String(prop);
      const fn = Reflect.get(target, prop, receiver);
      return instrumentStorageFn(fn, operation);
    }
  };
  return wrap(storage, storageHandler);
}

// src/instrumentation/do.ts
import { DurableObject as DurableObjectClass } from "cloudflare:workers";
var STUB_NON_RPC_PROPS = /* @__PURE__ */ new Set([
  "fetch",
  "id",
  "name",
  "connect"
  // Symbol.toPrimitive, Symbol.iterator, etc. — covered below by typeof check.
]);
function instrumentRpcMethod(fn, thisRef, nsName, methodName) {
  return new Proxy(fn, {
    apply(target, _thisArg, argArray) {
      const tracer2 = trace10.getTracer("@microlabs/otel-cf-workers");
      const attrs = {
        "do.namespace": nsName,
        "do.id": thisRef.id.toString(),
        "do.id.name": thisRef.id.name,
        "rpc.system": "cloudflare-do",
        "rpc.service": nsName,
        "rpc.method": methodName
      };
      return tracer2.startActiveSpan(
        `Durable Object RPC ${nsName}.${methodName}`,
        { kind: SpanKind10.CLIENT, attributes: attrs },
        async (span) => {
          try {
            const result = Reflect.apply(target, thisRef, argArray);
            const awaited = result instanceof Promise ? await result : result;
            span.setStatus({ code: SpanStatusCode5.OK });
            span.end();
            return awaited;
          } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode5.ERROR });
            span.end();
            throw error;
          }
        }
      );
    }
  });
}
function instrumentBindingStub(stub, nsName) {
  const stubHandler = {
    get(target, prop, receiver) {
      if (prop === "fetch") {
        const fetcher = Reflect.get(target, prop);
        const attrs = {
          name: `Durable Object ${nsName}`,
          "do.namespace": nsName,
          "do.id": target.id.toString(),
          "do.id.name": target.id.name
        };
        return instrumentClientFetch(fetcher, () => ({ includeTraceContext: true }), attrs);
      }
      if (typeof prop === "symbol" || STUB_NON_RPC_PROPS.has(prop)) {
        return passthroughGet(target, prop, receiver);
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }
      return instrumentRpcMethod(value, target, nsName, String(prop));
    }
  };
  return wrap(stub, stubHandler);
}
function instrumentBindingGet(getFn, nsName) {
  const getHandler = {
    apply(target, thisArg, argArray) {
      const stub = Reflect.apply(target, thisArg, argArray);
      return instrumentBindingStub(stub, nsName);
    }
  };
  return wrap(getFn, getHandler);
}
function instrumentDOBinding(ns, nsName) {
  const nsHandler = {
    get(target, prop, receiver) {
      if (prop === "get") {
        const fn = Reflect.get(ns, prop, receiver);
        return instrumentBindingGet(fn, nsName);
      } else {
        return passthroughGet(target, prop, receiver);
      }
    }
  };
  return wrap(ns, nsHandler);
}
function instrumentState(state) {
  const stateHandler = {
    get(target, prop, receiver) {
      const result = Reflect.get(target, prop, unwrap(receiver));
      if (prop === "storage") {
        return instrumentStorage(result);
      } else if (typeof result === "function") {
        return result.bind(target);
      } else {
        return result;
      }
    }
  };
  return wrap(state, stateHandler);
}
var cold_start = true;
function executeDOFetch(fetchFn, request, id) {
  const spanContext = getParentContextFromHeaders(request.headers);
  const tracer2 = trace10.getTracer("DO fetchHandler");
  const attributes = {
    [SemanticAttributes6.FAAS_TRIGGER]: "http",
    [SemanticAttributes6.FAAS_COLDSTART]: cold_start
  };
  cold_start = false;
  Object.assign(attributes, gatherRequestAttributes(request));
  Object.assign(attributes, gatherIncomingCfAttributes(request));
  const options = {
    attributes,
    kind: SpanKind10.SERVER
  };
  const name = id.name || "";
  const promise = tracer2.startActiveSpan(`Durable Object Fetch ${name}`, options, spanContext, async (span) => {
    try {
      const response = await fetchFn(request);
      if (response.ok) {
        span.setStatus({ code: SpanStatusCode5.OK });
      }
      span.setAttributes(gatherResponseAttributes(response));
      span.end();
      return response;
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode5.ERROR });
      span.end();
      throw error;
    }
  });
  return promise;
}
function executeDOAlarm(alarmFn, id) {
  const tracer2 = trace10.getTracer("DO alarmHandler");
  const name = id.name || "";
  const promise = tracer2.startActiveSpan(`Durable Object Alarm ${name}`, async (span) => {
    span.setAttribute(SemanticAttributes6.FAAS_COLDSTART, cold_start);
    cold_start = false;
    span.setAttribute("do.id", id.toString());
    if (id.name) span.setAttribute("do.name", id.name);
    try {
      await alarmFn();
      span.end();
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode5.ERROR });
      span.end();
      throw error;
    }
  });
  return promise;
}
function instrumentFetchFn(fetchFn, initialiser, env2, id) {
  const fetchHandler = {
    async apply(target, thisArg, argArray) {
      const request = argArray[0];
      const config = initialiser(env2, request);
      const context3 = setConfig(config);
      try {
        const bound = target.bind(unwrap(thisArg));
        return await api_context3.with(context3, executeDOFetch, void 0, bound, request, id);
      } catch (error) {
        throw error;
      }
    }
  };
  return wrap(fetchFn, fetchHandler);
}
function instrumentAlarmFn(alarmFn, initialiser, env2, id) {
  if (!alarmFn) return void 0;
  const alarmHandler = {
    async apply(target, thisArg) {
      const config = initialiser(env2, "do-alarm");
      const context3 = setConfig(config);
      try {
        const bound = target.bind(unwrap(thisArg));
        return await api_context3.with(context3, executeDOAlarm, void 0, bound, id);
      } catch (error) {
        throw error;
      }
    }
  };
  return wrap(alarmFn, alarmHandler);
}
function instrumentAnyFn(fn, initialiser, env2, _id) {
  if (!fn) return void 0;
  const fnHandler = {
    async apply(target, thisArg, argArray) {
      thisArg = unwrap(thisArg);
      const config = initialiser(env2, "do-alarm");
      const context3 = setConfig(config);
      try {
        const bound = target.bind(unwrap(thisArg));
        return await api_context3.with(context3, () => bound.apply(thisArg, argArray), void 0);
      } catch (error) {
        throw error;
      }
    }
  };
  return wrap(fn, fnHandler);
}
function instrumentDurableObject(doObj, initialiser, env2, state, classStyle) {
  const objHandler = {
    get(target, prop) {
      if (classStyle && prop === "ctx") {
        return state;
      } else if (classStyle && prop === "env") {
        return env2;
      } else if (prop === "fetch") {
        const fetchFn = Reflect.get(target, prop);
        return instrumentFetchFn(fetchFn, initialiser, env2, state.id);
      } else if (prop === "alarm") {
        const alarmFn = Reflect.get(target, prop);
        return instrumentAlarmFn(alarmFn, initialiser, env2, state.id);
      } else {
        const result = Reflect.get(target, prop);
        if (typeof result === "function") {
          result.bind(doObj);
          return instrumentAnyFn(result, initialiser, env2, state.id);
        }
        return result;
      }
    }
  };
  return wrap(doObj, objHandler);
}
function instrumentDOClass(doClass, initialiser) {
  const classHandler = {
    construct(target, [orig_state, orig_env]) {
      const trigger = {
        id: orig_state.id.toString(),
        name: orig_state.id.name
      };
      const constructorConfig = initialiser(orig_env, trigger);
      const context3 = setConfig(constructorConfig);
      const state = instrumentState(orig_state);
      const env2 = instrumentEnv(orig_env);
      const classStyle = doClass.prototype instanceof DurableObjectClass;
      const createDO = () => {
        if (classStyle) {
          return new target(orig_state, orig_env);
        } else {
          return new target(state, env2);
        }
      };
      const doObj = api_context3.with(context3, createDO);
      return instrumentDurableObject(doObj, initialiser, env2, state, classStyle);
    }
  };
  return wrap(doClass, classHandler);
}

// src/instrumentation/scheduled.ts
import { SpanKind as SpanKind11 } from "@opentelemetry/api";
import {
  ATTR_FAAS_CRON,
  ATTR_FAAS_TIME,
  ATTR_FAAS_TRIGGER as ATTR_FAAS_TRIGGER2,
  FAAS_TRIGGER_VALUE_TIMER
} from "@opentelemetry/semantic-conventions/incubating";
var scheduledInstrumentation = {
  getInitialSpanInfo: function(controller) {
    return {
      name: `scheduledHandler ${controller.cron}`,
      options: {
        attributes: {
          [ATTR_FAAS_TRIGGER2]: FAAS_TRIGGER_VALUE_TIMER,
          [ATTR_FAAS_CRON]: controller.cron,
          [ATTR_FAAS_TIME]: new Date(controller.scheduledTime).toISOString()
        },
        kind: SpanKind11.INTERNAL
      }
    };
  }
};

// src/instrumentation/version.ts
function versionAttributes(env2) {
  const attributes = {};
  if (typeof env2 === "object" && env2 !== null) {
    for (const [binding, data] of Object.entries(env2)) {
      if (isVersionMetadata(data)) {
        attributes["cf.workers_version_metadata.binding"] = binding;
        attributes["cf.workers_version_metadata.id"] = data.id;
        attributes["cf.workers_version_metadata.tag"] = data.tag;
        break;
      }
    }
  }
  return attributes;
}

// src/instrumentation/common.ts
import { trace as trace11 } from "@opentelemetry/api";
var PromiseTracker = class {
  _outstandingPromises = [];
  get outstandingPromiseCount() {
    return this._outstandingPromises.length;
  }
  track(promise) {
    this._outstandingPromises.push(promise);
  }
  async wait() {
    await allSettledMutable(this._outstandingPromises);
  }
};
function createWaitUntil(fn, context3, tracker) {
  const handler = {
    apply(target, _thisArg, argArray) {
      tracker.track(argArray[0]);
      return Reflect.apply(target, context3, argArray);
    }
  };
  return wrap(fn, handler);
}
function proxyExecutionContext(context3) {
  const tracker = new PromiseTracker();
  const ctx = new Proxy(context3, {
    get(target, prop) {
      if (prop === "waitUntil") {
        const fn = Reflect.get(target, prop);
        return createWaitUntil(fn, context3, tracker);
      } else {
        return passthroughGet(target, prop);
      }
    }
  });
  return { ctx, tracker };
}
async function allSettledMutable(promises) {
  let values;
  do {
    values = await Promise.allSettled(promises);
  } while (values.length !== promises.length);
  return values;
}

// src/instrumentation/email.ts
import { SpanKind as SpanKind12 } from "@opentelemetry/api";
import {
  ATTR_FAAS_TRIGGER as ATTR_FAAS_TRIGGER3,
  ATTR_MESSAGING_DESTINATION_NAME,
  ATTR_RPC_MESSAGE_ID
} from "@opentelemetry/semantic-conventions/incubating";
function headerAttributes(message) {
  return Object.fromEntries([...message.headers].map(([key, value]) => [`email.header.${key}`, value]));
}
var emailInstrumentation = {
  getInitialSpanInfo: (message) => {
    const attributes = {
      [ATTR_FAAS_TRIGGER3]: "other",
      [ATTR_RPC_MESSAGE_ID]: message.headers.get("Message-Id") ?? void 0,
      [ATTR_MESSAGING_DESTINATION_NAME]: message.to
    };
    Object.assign(attributes, headerAttributes(message));
    const options = {
      attributes,
      kind: SpanKind12.CONSUMER
    };
    return {
      name: `emailHandler ${message.to}`,
      options
    };
  }
};

// src/sdk.ts
import { env } from "cloudflare:workers";
function isRequest(trigger) {
  return trigger instanceof Request;
}
function isMessageBatch(trigger) {
  return !!trigger.ackAll;
}
function isAlarm(trigger) {
  return trigger === "do-alarm";
}
function findVersionMeta() {
  if (!env || typeof env !== "object") return void 0;
  return Object.values(env).find((binding) => {
    return binding != null && Object.getPrototypeOf(binding)?.constructor?.name === "Object" && binding.id !== void 0 && binding.tag !== void 0;
  });
}
var createResource = (config, versionMeta) => {
  const workerResourceAttrs = {
    "cloud.provider": "cloudflare",
    "cloud.platform": "cloudflare.workers",
    "cloud.region": "earth",
    "faas.max_memory": 134217728,
    "telemetry.sdk.language": "js",
    "telemetry.sdk.name": "@microlabs/otel-cf-workers",
    "telemetry.sdk.version": _microlabs_otel_cf_workers,
    "telemetry.sdk.build.node_version": node,
    "cf.worker.version.id": versionMeta?.id,
    "cf.worker.version.tag": versionMeta?.tag,
    "cf.worker.version.timestamp": versionMeta?.timestamp
  };
  const serviceResource = resourceFromAttributes({
    "service.name": config.service.name,
    "service.namespace": config.service.namespace,
    "service.version": config.service.version
  });
  const resource = resourceFromAttributes(workerResourceAttrs);
  return resource.merge(serviceResource);
};
var initialised = false;
function init(config) {
  if (!initialised) {
    if (config.instrumentation.instrumentGlobalCache) {
      instrumentGlobalCache();
    }
    if (config.instrumentation.instrumentGlobalFetch) {
      instrumentGlobalFetch();
    }
    propagation2.setGlobalPropagator(config.propagator);
    const resource = createResource(config, findVersionMeta());
    const provider = new WorkerTracerProvider(config.spanProcessors, resource);
    provider.register();
    initialised = true;
  }
}
function createInitialiser(config) {
  if (typeof config === "function") {
    return (env2, trigger) => {
      const conf = parseConfig(config(env2, trigger));
      init(conf);
      return conf;
    };
  } else {
    return () => {
      const conf = parseConfig(config);
      init(conf);
      return conf;
    };
  }
}
async function exportSpans(traceId, tracker) {
  const tracer2 = trace12.getTracer("export");
  if (tracer2 instanceof WorkerTracer) {
    await scheduler.wait(1);
    await tracker?.wait();
    await tracer2.forceFlush(traceId);
  } else {
    console.error("The global tracer is not of type WorkerTracer and can not export spans");
  }
}
var cold_start2 = true;
function createHandlerFlowFn(instrumentation) {
  return (handlerFn, args) => {
    const [trigger, env2, context3] = args;
    const proxiedEnv = instrumentEnv(env2);
    const { ctx: proxiedCtx, tracker } = proxyExecutionContext(context3);
    const instrumentedTrigger = instrumentation.instrumentTrigger ? instrumentation.instrumentTrigger(trigger) : trigger;
    const tracer2 = trace12.getTracer("handler");
    const { name, options, context: spanContext } = instrumentation.getInitialSpanInfo(trigger);
    const attrs = options.attributes || {};
    attrs["faas.coldstart"] = cold_start2;
    options.attributes = attrs;
    Object.assign(attrs, versionAttributes(env2));
    cold_start2 = false;
    const parentContext = spanContext || api_context4.active();
    const result = tracer2.startActiveSpan(name, options, parentContext, async (span) => {
      try {
        const result2 = await handlerFn(instrumentedTrigger, proxiedEnv, proxiedCtx);
        if (instrumentation.getAttributesFromResult) {
          const attributes = instrumentation.getAttributesFromResult(result2);
          span.setAttributes(attributes);
        }
        if (instrumentation.executionSucces) {
          instrumentation.executionSucces(span, trigger, result2);
        }
        return result2;
      } catch (error) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode6.ERROR });
        if (instrumentation.executionFailed) {
          instrumentation.executionFailed(span, trigger, error);
        }
        throw error;
      } finally {
        span.end();
        context3.waitUntil(exportSpans(span.spanContext().traceId, tracker));
      }
    });
    return result;
  };
}
function createHandlerProxy(handler, handlerFn, initialiser, instrumentation) {
  return (trigger, env2, ctx) => {
    const config = initialiser(env2, trigger);
    const context3 = setConfig(config);
    const flowFn = createHandlerFlowFn(instrumentation);
    return api_context4.with(context3, flowFn, handler, handlerFn, [trigger, env2, ctx]);
  };
}
function instrument(handler, config) {
  const initialiser = createInitialiser(config);
  if (handler.fetch) {
    const fetcher = unwrap(handler.fetch);
    handler.fetch = createHandlerProxy(handler, fetcher, initialiser, fetchInstrumentation);
  }
  if (handler.scheduled) {
    const scheduler2 = unwrap(handler.scheduled);
    handler.scheduled = createHandlerProxy(handler, scheduler2, initialiser, scheduledInstrumentation);
  }
  if (handler.queue) {
    const queuer = unwrap(handler.queue);
    handler.queue = createHandlerProxy(handler, queuer, initialiser, new QueueInstrumentation());
  }
  if (handler.email) {
    const emailer = unwrap(handler.email);
    handler.email = createHandlerProxy(handler, emailer, initialiser, emailInstrumentation);
  }
  return handler;
}
function instrumentDO(doClass, config) {
  const initialiser = createInitialiser(config);
  return instrumentDOClass(doClass, initialiser);
}
var __unwrappedFetch = unwrap(fetch);

// src/multiexporter.ts
import { ExportResultCode as ExportResultCode3 } from "@opentelemetry/core";
var MultiSpanExporter = class {
  exporters;
  constructor(exporters) {
    this.exporters = exporters;
  }
  export(items, resultCallback) {
    for (const exporter of this.exporters) {
      exporter.export(items, resultCallback);
    }
  }
  async shutdown() {
    for (const exporter of this.exporters) {
      await exporter.shutdown();
    }
  }
};
var MultiSpanExporterAsync = class {
  exporters;
  constructor(exporters) {
    this.exporters = exporters;
  }
  export(items, resultCallback) {
    const promises = this.exporters.map(
      (exporter) => new Promise((resolve) => {
        exporter.export(items, resolve);
      })
    );
    Promise.all(promises).then((results) => {
      const failed = results.filter((result) => result.code === ExportResultCode3.FAILED);
      if (failed.length > 0) {
        resultCallback({ code: ExportResultCode3.FAILED, error: failed[0].error });
      } else {
        resultCallback({ code: ExportResultCode3.SUCCESS });
      }
    });
  }
  async shutdown() {
    await Promise.all(this.exporters.map((exporter) => exporter.shutdown()));
  }
};
export {
  BatchTraceSpanProcessor,
  MultiSpanExporter,
  MultiSpanExporterAsync,
  OTLPExporter,
  SpanImpl,
  __unwrappedFetch,
  createSampler,
  exportSpans,
  instrument,
  instrumentDO,
  isAlarm,
  isHeadSampled,
  isMessageBatch,
  isRequest,
  isRootErrorSpan,
  multiTailSampler,
  withNextSpan
};
//# sourceMappingURL=index.js.map