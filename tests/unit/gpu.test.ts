import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * GPU detection for local processing: a GPU counts only when nvidia-smi
 * answers (hardware + working driver). Without one the top bar says
 * "No GPU" and local processing gets CPU-sized timeouts.
 */
const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

const { detectGpu, gpuLabel, parseNvidiaSmi, cpuTimeoutFactor, resetGpuCache } = await import("@/lib/gpu");

type Callback = (err: Error | null, stdout: string) => void;
const answer = (stdout: string) =>
  execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Callback) => cb(null, stdout));
const fail = (message: string) =>
  execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Callback) => cb(new Error(message), ""));

beforeEach(() => {
  resetGpuCache();
  execFileMock.mockReset();
});

describe("parsing nvidia-smi", () => {
  it("reads the first GPU's name, memory and driver", () => {
    expect(parseNvidiaSmi("NVIDIA GeForce GTX 1080 Ti, 11264, 581.57\r\n")).toEqual({
      available: true,
      name: "NVIDIA GeForce GTX 1080 Ti",
      memoryMiB: 11264,
      driver: "581.57",
    });
  });

  it("treats empty or error output as no GPU", () => {
    expect(parseNvidiaSmi("").available).toBe(false);
    expect(parseNvidiaSmi("No devices were found").available).toBe(false);
    expect(parseNvidiaSmi("NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver.").available).toBe(false);
  });
});

describe("labels", () => {
  it("shortens the model name for the top bar", () => {
    expect(gpuLabel(parseNvidiaSmi("NVIDIA GeForce GTX 1080 Ti, 11264, 581.57"))).toBe("GTX 1080 Ti");
    expect(gpuLabel(parseNvidiaSmi("NVIDIA A100-SXM4-80GB, 81920, 550.54"))).toBe("A100-SXM4-80GB");
    expect(gpuLabel({ available: false, name: null, memoryMiB: null, driver: null })).toBe("No GPU");
  });
});

describe("detection and CPU fallback", () => {
  it("uses the GPU when nvidia-smi answers", async () => {
    answer("NVIDIA GeForce GTX 1080 Ti, 11264, 581.57\n");
    expect(await detectGpu()).toMatchObject({ available: true, name: "NVIDIA GeForce GTX 1080 Ti" });
    expect(await cpuTimeoutFactor()).toBe(1);
  });

  it("falls back to the CPU when there is no nvidia-smi or no driver", async () => {
    fail("spawn nvidia-smi ENOENT");
    expect(await detectGpu()).toMatchObject({ available: false });
    expect(await cpuTimeoutFactor()).toBe(4); // CPU_TIMEOUT_FACTOR default
  });

  it("caches the result instead of running nvidia-smi on every request", async () => {
    answer("NVIDIA GeForce RTX 4090, 24564, 560.10\n");
    await detectGpu();
    await detectGpu();
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });
});
