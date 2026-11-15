import { useCallback, useEffect, useRef } from "react";

export type AnnualValue = { year: number; value: number | null };
export type MonthlyValue = {
  year: number;
  month: number;
  value: number | null;
  interpolatedValue?: number;
  isInterpolated?: boolean;
  validDailySamples?: number;
  candidateDailySamples?: number;
  validPixelSamples?: number;
  validSceneCount?: number;
  medianValidCoverage?: number;
  reviewNote?: string;
  uncertainty?: number;
  qualityCounts?: { goodSamples: number; marginalSamples: number };
};
export type AudioTheme = "sea-level" | "disasters" | "air-quality" | "agriculture" | "water-resources" | "biodiversity" | "energy" | "eic-frames";

export type ValueRange = { min: number; max: number };

export function interpolateShortMonthlyGaps(series: MonthlyValue[], maximumGap = 2): MonthlyValue[] {
  if (!series.length) return [];
  if (!Number.isInteger(maximumGap) || maximumGap < 0) {
    throw new RangeError("Maximum interpolated gap must be a non-negative integer.");
  }

  const timeline: MonthlyValue[] = [];
  for (let index = 0; index < series.length; index += 1) {
    const current = series[index];
    timeline.push(current);
    const next = series[index + 1];
    if (!next) continue;

    const currentMonth = current.year * 12 + current.month;
    const nextMonth = next.year * 12 + next.month;
    const missingMonths = nextMonth - currentMonth - 1;
    for (let offset = 1; offset <= missingMonths; offset += 1) {
      const monthIndex = currentMonth + offset;
      const year = Math.floor((monthIndex - 1) / 12);
      const month = monthIndex - year * 12;
      const fraction = offset / (missingMonths + 1);
      const interpolatedValue = missingMonths <= maximumGap
        && current.value !== null
        && Number.isFinite(current.value)
        && next.value !== null
        && Number.isFinite(next.value)
        ? current.value + (next.value - current.value) * fraction
        : undefined;
      timeline.push({
        year,
        month,
        value: null,
        ...(interpolatedValue !== undefined ? {
          interpolatedValue,
          isInterpolated: true,
        } : {}),
      });
    }
  }
  return timeline;
}

export function getAnnualValueRange(
  series: AnnualValue[],
  currentYear = new Date().getFullYear(),
): ValueRange | null {
  const validValues = series.filter(
    (point): point is { year: number; value: number } =>
      point.value !== null && Number.isFinite(point.value),
  );
  const completedValues = validValues.filter((point) => point.year < currentYear);
  const values = (completedValues.length ? completedValues : validValues).map((point) => point.value);
  if (values.length === 0) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}

export function normalizeAnnualValue(value: number | null | undefined, range: ValueRange | null): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || !range) return null;
  if (range.min === range.max) return 0.5;
  return Math.min(1, Math.max(0, (value - range.min) / (range.max - range.min)));
}

export function normalizeSelectedYear(
  series: AnnualValue[],
  year: number,
  currentYear = new Date().getFullYear(),
): number | null {
  const point = series.find((item) => item.year === year);
  return normalizeAnnualValue(point?.value, getAnnualValueRange(series, currentYear));
}

export type SonificationUpdater = {
  update: (primaryValue: number, secondaryValue?: number) => void;
};

export function updateEngineForYear(
  engine: SonificationUpdater,
  primarySeries: AnnualValue[],
  year: number,
  secondarySeries?: AnnualValue[],
  currentYear = new Date().getFullYear(),
): { primary: number; secondary: number | null } | null {
  const primary = normalizeSelectedYear(primarySeries, year, currentYear);
  if (primary === null) return null;
  const secondary = secondarySeries ? normalizeSelectedYear(secondarySeries, year, currentYear) : null;
  engine.update(primary, secondary ?? undefined);
  return { primary, secondary };
}

export function normalizeSelectedMonth(
  series: MonthlyValue[],
  year: number,
  month: number,
  currentDate = new Date(),
): number | null {
  const point = series.find((item) => item.year === year && item.month === month);
  const validValues = series.filter(
    (item): item is MonthlyValue & { value: number } =>
      item.value !== null && Number.isFinite(item.value),
  );
  const completedValues = validValues.filter(
    (item) => item.year < currentDate.getFullYear()
      || (item.year === currentDate.getFullYear() && item.month < currentDate.getMonth() + 1),
  );
  const values = (completedValues.length ? completedValues : validValues).map((item) => item.value);
  const selectedValue = point?.value ?? point?.interpolatedValue ?? null;
  if (selectedValue === null || !Number.isFinite(selectedValue) || values.length === 0) return null;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (minimum === maximum) return 0.5;
  return Math.min(1, Math.max(0, (selectedValue - minimum) / (maximum - minimum)));
}

export function updateEngineForMonth(
  engine: SonificationUpdater,
  primarySeries: MonthlyValue[],
  year: number,
  month: number,
  secondarySeries?: MonthlyValue[],
  currentDate = new Date(),
): { primary: number; secondary: number | null } | null {
  const primary = normalizeSelectedMonth(primarySeries, year, month, currentDate);
  if (primary === null) return null;
  const secondary = secondarySeries
    ? normalizeSelectedMonth(secondarySeries, year, month, currentDate)
    : null;
  engine.update(primary, secondary ?? undefined);
  return { primary, secondary };
}

type Voice = {
  nodes: AudioNode[];
  sources: AudioScheduledSourceNode[];
  output: GainNode;
  update: (primary: number, secondary: number) => void;
};

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function analyzeFramePixels(pixels: ArrayLike<number>) {
  if (pixels.length === 0 || pixels.length % 4 !== 0) {
    throw new RangeError("Frame pixels must contain complete RGBA values.");
  }

  let brightness = 0;
  let colorVariation = 0;
  const pixelCount = pixels.length / 4;
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index] / 255;
    const green = pixels[index + 1] / 255;
    const blue = pixels[index + 2] / 255;
    brightness += 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    colorVariation += Math.max(red, green, blue) - Math.min(red, green, blue);
  }

  return {
    brightness: brightness / pixelCount,
    colorVariation: colorVariation / pixelCount,
  };
}

function target(param: AudioParam, value: number, context: AudioContext, timeConstant = 0.55) {
  param.setTargetAtTime(value, context.currentTime, timeConstant);
}

function createOutput(context: AudioContext, master: GainNode) {
  const output = context.createGain();
  output.gain.setValueAtTime(0, context.currentTime);
  output.connect(master);
  return output;
}

function createSeaLevelVoice(context: AudioContext, master: GainNode): Voice {
  const oscillator = context.createOscillator();
  const output = createOutput(context, master);
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(220, context.currentTime);
  oscillator.connect(output);
  return {
    nodes: [oscillator, output],
    sources: [oscillator],
    output,
    update: (value) => {
      target(oscillator.frequency, 220 + value * 540, context);
      target(oscillator.detune, value * 36, context);
      target(output.gain, 0.24 + value * 0.16, context);
    },
  };
}

function createWaterResourcesVoice(context: AudioContext, master: GainNode): Voice {
  const oscillator = context.createOscillator();
  const filter = context.createBiquadFilter();
  const output = createOutput(context, master);
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(170, context.currentTime);
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1200, context.currentTime);
  filter.Q.setValueAtTime(0.6, context.currentTime);
  oscillator.connect(filter).connect(output);
  return {
    nodes: [oscillator, filter, output],
    sources: [oscillator],
    output,
    update: (value) => {
      target(oscillator.frequency, 170 + value * 300, context);
      target(filter.frequency, 1200 + value * 5200, context);
      target(output.gain, 0.13 + value * 0.08, context);
    },
  };
}

function createDisasterVoice(context: AudioContext, master: GainNode): Voice {
  const frameCount = context.sampleRate * 2;
  const noiseBuffer = context.createBuffer(1, frameCount, context.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let index = 0; index < frameCount; index += 1) noiseData[index] = Math.random() * 2 - 1;

  const noise = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gate = context.createGain();
  const output = createOutput(context, master);
  const lfo = context.createOscillator();
  const lfoDepth = context.createGain();
  noise.buffer = noiseBuffer;
  noise.loop = true;
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(350, context.currentTime);
  filter.Q.setValueAtTime(0.8, context.currentTime);
  gate.gain.setValueAtTime(0.5, context.currentTime);
  lfo.type = "sine";
  lfo.frequency.setValueAtTime(0.35, context.currentTime);
  lfoDepth.gain.setValueAtTime(0.05, context.currentTime);
  noise.connect(filter).connect(gate).connect(output);
  lfo.connect(lfoDepth).connect(gate.gain);
  return {
    nodes: [noise, filter, gate, output, lfo, lfoDepth],
    sources: [noise, lfo],
    output,
    update: (rain, wind) => {
      target(lfo.frequency, 0.35 + rain * 4.1, context);
      target(lfoDepth.gain, 0.04 + rain * 0.42, context);
      target(output.gain, 0.025 + rain * 0.17, context);
      target(filter.frequency, 350 + wind * 2850, context);
      target(filter.Q, 0.8 + wind * 1.4, context);
    },
  };
}

function createAirQualityVoice(context: AudioContext, master: GainNode): Voice {
  const oscillator = context.createOscillator();
  const filter = context.createBiquadFilter();
  const output = createOutput(context, master);
  oscillator.type = "sawtooth";
  oscillator.frequency.setValueAtTime(110, context.currentTime);
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(5200, context.currentTime);
  filter.Q.setValueAtTime(0.7, context.currentTime);
  oscillator.connect(filter).connect(output);
  return {
    nodes: [oscillator, filter, output],
    sources: [oscillator],
    output,
    update: (value) => {
      target(filter.frequency, 5200 - value * 4300, context);
      target(output.gain, 0.12, context);
    },
  };
}

function createAgricultureVoice(context: AudioContext, master: GainNode): Voice {
  const ratios = [1, 1.25, 1.5];
  const oscillators = ratios.map((ratio) => {
    const oscillator = context.createOscillator();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(174 * ratio, context.currentTime);
    return oscillator;
  });
  const gains = oscillators.map(() => context.createGain());
  const output = createOutput(context, master);
  oscillators.forEach((oscillator, index) => oscillator.connect(gains[index]).connect(output));
  return {
    nodes: [...oscillators, ...gains, output],
    sources: oscillators,
    output,
    update: (value) => {
      const baseFrequency = 174 + value * 82;
      const voiceGains = [0.22 + value * 0.13, 0.015 + value * 0.1, 0.01 + value * 0.075];
      const detunes = [0, value * 8, value * 14];
      target(output.gain, 0.75, context);
      oscillators.forEach((oscillator, index) => {
        target(oscillator.frequency, baseFrequency * ratios[index], context);
        target(oscillator.detune, detunes[index], context);
        target(gains[index].gain, voiceGains[index], context);
      });
    },
  };
}

function createBiodiversityVoice(context: AudioContext, master: GainNode): Voice {
  const ratios = [1, 1.5, 2];
  const oscillators = ratios.map((ratio, index) => {
    const oscillator = context.createOscillator();
    oscillator.type = index === 1 ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(164 * ratio, context.currentTime);
    return oscillator;
  });
  const gains = oscillators.map(() => context.createGain());
  const output = createOutput(context, master);
  oscillators.forEach((oscillator, index) => oscillator.connect(gains[index]).connect(output));
  return {
    nodes: [...oscillators, ...gains, output],
    sources: oscillators,
    output,
    update: (value) => {
      const baseFrequency = 164 + value * 116;
      const voiceGains = [0.16 + value * 0.08, 0.025 + value * 0.08, 0.012 + value * 0.045];
      target(output.gain, 0.72, context);
      oscillators.forEach((oscillator, index) => {
        target(oscillator.frequency, baseFrequency * ratios[index], context);
        target(gains[index].gain, voiceGains[index], context);
      });
    },
  };
}

function createEnergyVoice(context: AudioContext, master: GainNode): Voice {
  const ratios = [1, 2, 3];
  const oscillators = ratios.map((ratio) => {
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(130 * ratio, context.currentTime);
    return oscillator;
  });
  const gains = oscillators.map(() => context.createGain());
  const output = createOutput(context, master);
  oscillators.forEach((oscillator, index) => oscillator.connect(gains[index]).connect(output));
  return {
    nodes: [...oscillators, ...gains, output],
    sources: oscillators,
    output,
    update: (value) => {
      const baseFrequency = 130 + value * 260;
      oscillators.forEach((oscillator, index) => {
        target(oscillator.frequency, baseFrequency * ratios[index], context);
        target(gains[index].gain, index === 0 ? 0.18 : 0.025 + value * 0.045, context);
      });
      target(output.gain, 0.7, context);
    },
  };
}

function createEicFrameVoice(context: AudioContext, master: GainNode): Voice {
  const ratios = [1, 1.5, 2];
  const oscillators = ratios.map((ratio, index) => {
    const oscillator = context.createOscillator();
    oscillator.type = index === 1 ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(165 * ratio, context.currentTime);
    return oscillator;
  });
  const gains = oscillators.map(() => context.createGain());
  const output = createOutput(context, master);
  oscillators.forEach((oscillator, index) => oscillator.connect(gains[index]).connect(output));
  return {
    nodes: [...oscillators, ...gains, output],
    sources: oscillators,
    output,
    update: (brightness, colorVariation) => {
      const baseFrequency = 130 + brightness * 300;
      const overtoneLevel = 0.015 + colorVariation * 0.07;
      oscillators.forEach((oscillator, index) => {
        target(oscillator.frequency, baseFrequency * ratios[index], context);
        target(gains[index].gain, index === 0 ? 0.2 : overtoneLevel / index, context);
      });
      target(output.gain, 0.72, context);
    },
  };
}

function createVoice(theme: AudioTheme, context: AudioContext, master: GainNode): Voice {
  if (theme === "sea-level") return createSeaLevelVoice(context, master);
  if (theme === "disasters") return createDisasterVoice(context, master);
  if (theme === "air-quality") return createAirQualityVoice(context, master);
  if (theme === "water-resources") return createWaterResourcesVoice(context, master);
  if (theme === "biodiversity") return createBiodiversityVoice(context, master);
  if (theme === "energy") return createEnergyVoice(context, master);
  if (theme === "eic-frames") return createEicFrameVoice(context, master);
  return createAgricultureVoice(context, master);
}

export class SonificationEngine implements SonificationUpdater {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private voice: Voice | null = null;
  private theme: AudioTheme;
  private primaryValue = 0.5;
  private secondaryValue = 0.5;
  private muted = false;
  private playing = false;

  constructor(theme: AudioTheme) {
    this.theme = theme;
  }

  private ensureGraph() {
    if (this.context && this.master) return this.context;
    if (typeof AudioContext === "undefined") throw new Error("Web Audio is unavailable in this browser.");
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.setValueAtTime(0, this.context.currentTime);
    this.master.connect(this.context.destination);
    this.createActiveVoice();
    return this.context;
  }

  private createActiveVoice() {
    if (!this.context || !this.master) return;
    this.voice = createVoice(this.theme, this.context, this.master);
    this.voice.update(this.primaryValue, this.secondaryValue);
    this.voice.sources.forEach((source) => source.start());
  }

  private disconnectVoice() {
    if (!this.voice) return;
    for (const source of this.voice.sources) {
      try {
        source.stop();
      } catch {
        // A source can already have ended during teardown.
      }
    }
    this.voice.nodes.forEach((node) => node.disconnect());
    this.voice = null;
  }

  private updateMasterGain() {
    if (!this.context || !this.master) return;
    target(this.master.gain, this.playing && !this.muted ? 0.2 : 0, this.context, 0.22);
  }

  async play() {
    const context = this.ensureGraph();
    this.playing = true;
    await context.resume();
    this.updateMasterGain();
  }

  pause() {
    this.playing = false;
    this.updateMasterGain();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.updateMasterGain();
  }

  setTheme(theme: AudioTheme) {
    if (this.theme === theme) return;
    this.theme = theme;
    if (!this.context || !this.master) return;
    this.disconnectVoice();
    this.createActiveVoice();
    this.updateMasterGain();
  }

  update(primaryValue: number, secondaryValue?: number) {
    if (Number.isFinite(primaryValue)) this.primaryValue = clamp(primaryValue);
    if (secondaryValue !== undefined && Number.isFinite(secondaryValue)) {
      this.secondaryValue = clamp(secondaryValue);
    }
    this.voice?.update(this.primaryValue, this.secondaryValue);
  }

  dispose() {
    this.playing = false;
    this.disconnectVoice();
    this.master?.disconnect();
    const context = this.context;
    this.master = null;
    this.context = null;
    if (context && context.state !== "closed") void context.close();
  }
}

type UseSonificationOptions = {
  theme: AudioTheme;
  primarySeries: MonthlyValue[];
  year: number;
  month: number;
  secondarySeries?: MonthlyValue[];
  muted: boolean;
};

export function useSonification({ theme, primarySeries, year, month, secondarySeries, muted }: UseSonificationOptions) {
  const engineRef = useRef<SonificationEngine | null>(null);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setTheme(theme);
    updateEngineForMonth(engine, primarySeries, year, month, secondarySeries);
  }, [theme, primarySeries, year, month, secondarySeries]);

  useEffect(() => {
    engineRef.current?.setMuted(muted);
  }, [muted]);

  useEffect(() => () => {
    engineRef.current?.dispose();
    engineRef.current = null;
  }, []);

  const start = async (startYear = year, startMonth = month) => {
    let engine = engineRef.current;
    if (!engine) {
      engine = new SonificationEngine(theme);
      engineRef.current = engine;
    }
    engine.setTheme(theme);
    updateEngineForMonth(engine, primarySeries, startYear, startMonth, secondarySeries);
    engine.setMuted(muted);
    try {
      await engine.play();
    } catch (error) {
      engine.dispose();
      if (engineRef.current === engine) engineRef.current = null;
      throw error;
    }
  };

  const pause = () => engineRef.current?.pause();

  return { start, pause };
}

export function useEicFrameSonification() {
  const engineRef = useRef<SonificationEngine | null>(null);
  const featuresRef = useRef({ brightness: 0.5, colorVariation: 0.25 });

  useEffect(() => () => {
    engineRef.current?.dispose();
    engineRef.current = null;
  }, []);

  const update = useCallback((brightness: number, colorVariation: number) => {
    featuresRef.current = { brightness, colorVariation };
    engineRef.current?.update(brightness, colorVariation);
  }, []);

  const start = useCallback(async () => {
    let engine = engineRef.current;
    if (!engine) {
      engine = new SonificationEngine("eic-frames");
      engineRef.current = engine;
    }
    engine.update(featuresRef.current.brightness, featuresRef.current.colorVariation);
    try {
      await engine.play();
    } catch (error) {
      engine.dispose();
      if (engineRef.current === engine) engineRef.current = null;
      throw error;
    }
  }, []);

  const pause = useCallback(() => engineRef.current?.pause(), []);

  return { start, update, pause };
}