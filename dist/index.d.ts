import { SpanExporter, ReadableSpan, Sampler, SpanProcessor, TimedEvent } from '@opentelemetry/sdk-trace-base';
import { TextMapPropagator, SpanOptions, Context, Attributes, Span, SpanContext, SpanKind, SpanStatus, HrTime, Link, TimeInput, AttributeValue, Exception } from '@opentelemetry/api';
import { ExportResult, InstrumentationScope } from '@opentelemetry/core';
import { OTLPExporterError } from '@opentelemetry/otlp-exporter-base';
import { DurableObject as DurableObject$1 } from 'cloudflare:workers';
import { Resource } from '@opentelemetry/resources';

interface OTLPExporterConfig {
    url: string;
    headers?: Record<string, string>;
}
declare class OTLPExporter implements SpanExporter {
    private headers;
    private url;
    constructor(config: OTLPExporterConfig);
    export(items: any[], resultCallback: (result: ExportResult) => void): void;
    private _export;
    send(items: any[], onSuccess: () => void, onError: (error: OTLPExporterError) => void): void;
    shutdown(): Promise<void>;
}

type IncludeTraceContextFn = (request: Request) => boolean;
interface FetcherConfig {
    includeTraceContext?: boolean | IncludeTraceContextFn;
}
type AcceptTraceContextFn = (request: Request) => boolean;
interface FetchHandlerConfig {
    /**
     * Whether to enable context propagation for incoming requests to `fetch`.
     * This enables or disables distributed tracing from W3C Trace Context headers.
     * @default true
     */
    acceptTraceContext?: boolean | AcceptTraceContextFn;
}

type OrPromise<T extends any> = T | Promise<T>;
type ResolveConfigFn<Env = any> = (env: Env, trigger: Trigger) => TraceConfig;
type ConfigurationOption = TraceConfig | ResolveConfigFn;
type PostProcessorFn = (spans: ReadableSpan[]) => ReadableSpan[];
type ExporterConfig = OTLPExporterConfig | SpanExporter;
interface InitialSpanInfo {
    name: string;
    options: SpanOptions;
    context?: Context;
}
interface HandlerInstrumentation<T extends Trigger, R extends any> {
    getInitialSpanInfo: (trigger: T) => InitialSpanInfo;
    getAttributesFromResult?: (result: Awaited<R>) => Attributes;
    instrumentTrigger?: (trigger: T) => T;
    executionSucces?: (span: Span, trigger: T, result: Awaited<R>) => void;
    executionFailed?: (span: Span, trigger: T, error?: any) => void;
}
type TraceFlushableSpanProcessor = SpanProcessor & {
    forceFlush: (traceId?: string) => Promise<void>;
};
interface HandlerConfig {
    fetch?: FetchHandlerConfig;
}
interface ServiceConfig {
    name: string;
    namespace?: string;
    version?: string;
}
interface ParentRatioSamplingConfig {
    acceptRemote?: boolean;
    ratio: number;
}
type HeadSamplerConf = Sampler | ParentRatioSamplingConfig;
interface SamplingConfig<HS extends HeadSamplerConf = HeadSamplerConf> {
    headSampler?: HS;
    tailSampler?: TailSampleFn;
}
interface InstrumentationOptions {
    instrumentGlobalFetch?: boolean;
    instrumentGlobalCache?: boolean;
}
interface TraceConfigBase {
    service: ServiceConfig;
    handlers?: HandlerConfig;
    fetch?: FetcherConfig;
    postProcessor?: PostProcessorFn;
    sampling?: SamplingConfig;
    propagator?: TextMapPropagator;
    instrumentation?: InstrumentationOptions;
}
interface TraceConfigExporter extends TraceConfigBase {
    exporter: ExporterConfig;
}
interface TraceConfigSpanProcessors extends TraceConfigBase {
    spanProcessors: SpanProcessor | SpanProcessor[];
}
type TraceConfig = TraceConfigExporter | TraceConfigSpanProcessors;
declare function isSpanProcessorConfig(config: TraceConfig): config is TraceConfigSpanProcessors;
interface ResolvedTraceConfig extends TraceConfigBase {
    handlers: Required<HandlerConfig>;
    fetch: Required<FetcherConfig>;
    postProcessor: PostProcessorFn;
    sampling: Required<SamplingConfig<Sampler>>;
    spanProcessors: SpanProcessor[];
    propagator: TextMapPropagator;
    instrumentation: InstrumentationOptions;
}
interface DOConstructorTrigger {
    id: string;
    name?: string;
}
type Trigger = Request | MessageBatch | ScheduledController | DOConstructorTrigger | 'do-alarm' | ForwardableEmailMessage;

interface LocalTrace {
    readonly traceId: string;
    readonly localRootSpan: ReadableSpan;
    readonly spans: ReadableSpan[];
}
type TailSampleFn = (traceInfo: LocalTrace) => boolean;
declare function multiTailSampler(samplers: TailSampleFn[]): TailSampleFn;
declare const isHeadSampled: TailSampleFn;
declare const isRootErrorSpan: TailSampleFn;
declare function createSampler(conf: ParentRatioSamplingConfig): Sampler;

type DO = DurableObject | DurableObject$1;
type DOClass = {
    new (state: DurableObjectState, env: any): DO;
};

declare class PromiseTracker {
    _outstandingPromises: Promise<unknown>[];
    get outstandingPromiseCount(): number;
    track(promise: Promise<unknown>): void;
    wait(): Promise<void>;
}

type Env = Record<string, any>;
declare function isRequest(trigger: Trigger): trigger is Request;
declare function isMessageBatch(trigger: Trigger): trigger is MessageBatch;
declare function isAlarm(trigger: Trigger): trigger is 'do-alarm';
declare function exportSpans(traceId: string, tracker?: PromiseTracker): Promise<void>;
declare function instrument<E extends Env, Q, C>(handler: ExportedHandler<E, Q, C>, config: ConfigurationOption): ExportedHandler<E, Q, C>;
declare function instrumentDO(doClass: DOClass, config: ConfigurationOption): DOClass;
declare const __unwrappedFetch: typeof fetch;

type OnSpanEnd = (span: Span) => void;
interface SpanInit {
    attributes: unknown;
    name: string;
    onEnd: OnSpanEnd;
    resource: Resource;
    spanContext: SpanContext;
    parentSpanContext?: SpanContext;
    links?: Link[];
    parentSpanId?: string;
    spanKind?: SpanKind;
    startTime?: TimeInput;
}
declare class SpanImpl implements Span, ReadableSpan {
    name: string;
    private readonly _spanContext;
    private readonly onEnd;
    readonly parentSpanId?: string;
    readonly parentSpanContext?: SpanContext | undefined;
    readonly kind: SpanKind;
    readonly attributes: Attributes;
    status: SpanStatus;
    endTime: HrTime;
    private _duration;
    readonly startTime: HrTime;
    readonly events: TimedEvent[];
    readonly links: Link[];
    readonly resource: Resource;
    instrumentationScope: InstrumentationScope;
    private _ended;
    private _droppedAttributesCount;
    private _droppedEventsCount;
    private _droppedLinksCount;
    constructor(init: SpanInit);
    addLink(link: Link): this;
    addLinks(links: Link[]): this;
    spanContext(): SpanContext;
    setAttribute(key: string, value?: AttributeValue): this;
    setAttributes(attributes: Attributes): this;
    addEvent(name: string, attributesOrStartTime?: Attributes | TimeInput, startTime?: TimeInput): this;
    setStatus(status: SpanStatus): this;
    updateName(name: string): this;
    end(endTime?: TimeInput): void;
    isRecording(): boolean;
    recordException(exception: Exception, time?: TimeInput): void;
    get duration(): HrTime;
    get ended(): boolean;
    get droppedAttributesCount(): number;
    get droppedEventsCount(): number;
    get droppedLinksCount(): number;
}

declare class MultiSpanExporter implements SpanExporter {
    private exporters;
    constructor(exporters: Array<SpanExporter>);
    export(items: any[], resultCallback: (result: ExportResult) => void): void;
    shutdown(): Promise<void>;
}
declare class MultiSpanExporterAsync implements SpanExporter {
    private exporters;
    constructor(exporters: Array<SpanExporter>);
    export(items: any[], resultCallback: (result: ExportResult) => void): void;
    shutdown(): Promise<void>;
}

declare class TraceState {
    private unexportedSpans;
    private inprogressSpans;
    private exporter;
    private exportPromises;
    private localRootSpan?;
    private traceDecision?;
    constructor(exporter: SpanExporter);
    addSpan(span: Span): void;
    endSpan(span: ReadableSpan): void;
    sample(): void;
    flush(): Promise<void>;
    private isSpanInProgress;
    private exportSpans;
}
type traceId = string;
declare class BatchTraceSpanProcessor implements TraceFlushableSpanProcessor {
    private exporter;
    private traces;
    constructor(exporter: SpanExporter);
    getTraceState(traceId: string): TraceState;
    onStart(span: Span, _parentContext: Context): void;
    onEnd(span: ReadableSpan): void;
    forceFlush(traceId?: traceId): Promise<void>;
    shutdown(): Promise<void>;
}

declare function withNextSpan(attrs: Attributes): void;

export { BatchTraceSpanProcessor, type ConfigurationOption, type DOConstructorTrigger, type ExporterConfig, type HandlerConfig, type HandlerInstrumentation, type InitialSpanInfo, type InstrumentationOptions, type LocalTrace, MultiSpanExporter, MultiSpanExporterAsync, OTLPExporter, type OTLPExporterConfig, type OrPromise, type ParentRatioSamplingConfig, type PostProcessorFn, type ResolveConfigFn, type ResolvedTraceConfig, type SamplingConfig, type ServiceConfig, SpanImpl, type TailSampleFn, type TraceConfig, type TraceFlushableSpanProcessor, type Trigger, __unwrappedFetch, createSampler, exportSpans, instrument, instrumentDO, isAlarm, isHeadSampled, isMessageBatch, isRequest, isRootErrorSpan, isSpanProcessorConfig, multiTailSampler, withNextSpan };
