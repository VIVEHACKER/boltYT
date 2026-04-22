/**
 * Web Audio API minimal stub for Vitest / Node.js / jsdom environments.
 *
 * Covers the surface used by voice-dsp.ts and audio-effects-web.ts:
 *   OfflineAudioContext, AudioContext, AudioBuffer, AudioBufferSourceNode,
 *   GainNode, BiquadFilterNode, DynamicsCompressorNode, DelayNode,
 *   ConvolverNode, AudioParam.
 */

// ─── AudioParam stub ────────────────────────────────────────────────────────

class MockAudioParam {
	value = 0;
}

// ─── AudioNode base ─────────────────────────────────────────────────────────

class MockAudioNode {
	connect(_dest: unknown) {
		return _dest as MockAudioNode;
	}
	disconnect() {}
}

// ─── Concrete nodes ──────────────────────────────────────────────────────────

class MockGainNode extends MockAudioNode {
	gain = new MockAudioParam();
}

class MockBiquadFilterNode extends MockAudioNode {
	type: string = "lowpass";
	frequency = new MockAudioParam();
	Q = new MockAudioParam();
	gain = new MockAudioParam();
}

class MockDynamicsCompressorNode extends MockAudioNode {
	threshold = new MockAudioParam();
	ratio = new MockAudioParam();
	attack = new MockAudioParam();
	release = new MockAudioParam();
	knee = new MockAudioParam();
}

class MockDelayNode extends MockAudioNode {
	delayTime = new MockAudioParam();
}

class MockConvolverNode extends MockAudioNode {
	buffer: MockAudioBuffer | null = null;
}

class MockAudioBufferSourceNode extends MockAudioNode {
	buffer: MockAudioBuffer | null = null;
	start(_when?: number) {}
}

// ─── AudioBuffer ─────────────────────────────────────────────────────────────

class MockAudioBuffer {
	readonly numberOfChannels: number;
	readonly length: number;
	readonly sampleRate: number;
	readonly duration: number;
	private _channels: Float32Array[];

	constructor(options: {
		numberOfChannels: number;
		length: number;
		sampleRate: number;
	}) {
		this.numberOfChannels = options.numberOfChannels;
		this.length = options.length;
		this.sampleRate = options.sampleRate;
		this.duration = options.length / options.sampleRate;
		this._channels = Array.from(
			{ length: options.numberOfChannels },
			() => new Float32Array(options.length),
		);
	}

	getChannelData(channel: number): Float32Array {
		return this._channels[channel] ?? new Float32Array(0);
	}

	copyFromChannel(destination: Float32Array, channel: number) {
		destination.set(this._channels[channel] ?? []);
	}

	copyToChannel(source: Float32Array, channel: number) {
		const ch = this._channels[channel];
		if (ch) ch.set(source);
	}
}

// ─── BaseAudioContext mixin ──────────────────────────────────────────────────

class MockBaseAudioContext {
	sampleRate = 44100;
	destination = new MockAudioNode();

	createGain() {
		return new MockGainNode();
	}

	createBiquadFilter() {
		return new MockBiquadFilterNode();
	}

	createDynamicsCompressor() {
		return new MockDynamicsCompressorNode();
	}

	createDelay(_maxDelay?: number) {
		return new MockDelayNode();
	}

	createConvolver() {
		return new MockConvolverNode();
	}

	createBuffer(numberOfChannels: number, length: number, sampleRate: number) {
		return new MockAudioBuffer({ numberOfChannels, length, sampleRate });
	}

	createBufferSource() {
		return new MockAudioBufferSourceNode();
	}
}

// ─── OfflineAudioContext ──────────────────────────────────────────────────────

class MockOfflineAudioContext extends MockBaseAudioContext {
	private _channels: number;
	private _length: number;

	constructor(numberOfChannels: number, length: number, sampleRate: number) {
		super();
		this._channels = numberOfChannels;
		this._length = length;
		this.sampleRate = sampleRate;
	}

	async startRendering(): Promise<MockAudioBuffer> {
		return new MockAudioBuffer({
			numberOfChannels: this._channels,
			length: this._length,
			sampleRate: this.sampleRate,
		});
	}
}

// ─── AudioContext ─────────────────────────────────────────────────────────────

class MockAudioContext extends MockBaseAudioContext {
	state: AudioContextState = "running";

	async decodeAudioData(_buffer: ArrayBuffer): Promise<MockAudioBuffer> {
		// Return a minimal 1-channel 100-sample buffer
		return new MockAudioBuffer({
			numberOfChannels: 1,
			length: 100,
			sampleRate: 44100,
		});
	}

	async close() {
		this.state = "closed";
	}
}

// ─── Install globals ──────────────────────────────────────────────────────────

// @ts-expect-error — patching global for test environment
globalThis.AudioContext = MockAudioContext;
// @ts-expect-error — patching global for test environment
globalThis.OfflineAudioContext = MockOfflineAudioContext;
// @ts-expect-error — patching global for test environment
globalThis.AudioBuffer = MockAudioBuffer;
// @ts-expect-error — patching global for test environment
globalThis.AudioNode = MockAudioNode;

// voice-dsp.ts uses `window.AudioContext` — expose globalThis as window in Node
if (typeof window === "undefined") {
	// @ts-expect-error — Node test shim
	globalThis.window = globalThis;
}

export {
	MockAudioBuffer,
	MockAudioContext,
	MockBiquadFilterNode,
	MockDynamicsCompressorNode,
	MockGainNode,
	MockOfflineAudioContext,
};
