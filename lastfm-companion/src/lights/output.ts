import dgram from "node:dgram";
import { SerialPort } from "serialport";
import { LightsConfig } from "./config";

export const UNIVERSE_SIZE = 512;
const ARTNET_PORT = 6454;

export interface DmxOutput {
  readonly name: string;
  send(universe: Uint8Array): void;
  close(): void;
}

// ArtDmx packet (Art-Net 4): "Art-Net\0", OpOutput 0x5000 little-endian, protocol 14, sequence, physical, SubUni, Net, length big-endian.
export function artnetPacket(data: Uint8Array, universe: number, sequence: number): Buffer {
  const header = Buffer.from([
    ...Buffer.from("Art-Net\0", "ascii"), 0x00, 0x50, 0, 14, sequence & 0xff, 0,
    universe & 0xff, (universe >> 8) & 0x7f, (data.length >> 8) & 0xff, data.length & 0xff
  ]);
  return Buffer.concat([header, Buffer.from(data)]);
}

// Enttec DMX USB Pro "Output Only Send DMX" (label 6): 0x7E, label, length LSB/MSB, start code 0 + channels, 0xE7.
export function enttecProPacket(data: Uint8Array): Buffer {
  const length = data.length + 1;
  return Buffer.concat([Buffer.from([0x7e, 6, length & 0xff, length >> 8, 0]), Buffer.from(data), Buffer.from([0xe7])]);
}

class ArtNetOutput implements DmxOutput {
  private socket = dgram.createSocket("udp4");
  private sequence = 0;
  readonly name: string;

  constructor(private host: string, private universe: number, log: (message: string) => void) {
    this.name = `Art-Net ${host} universe ${universe}`;
    this.socket.on("error", error => log(`Art-Net: ${error.message}`));
    this.socket.bind(() => this.socket.setBroadcast(true));
  }

  send(universe: Uint8Array): void {
    this.sequence = this.sequence % 255 + 1;
    this.socket.send(artnetPacket(universe, this.universe, this.sequence), ARTNET_PORT, this.host);
  }

  close(): void {
    this.socket.close();
  }
}

class SerialDmxOutput implements DmxOutput {
  private busy = false;
  readonly name: string;

  constructor(private port: SerialPort, private pro: boolean, private log: (message: string) => void) {
    this.name = `${pro ? "Enttec DMX USB Pro" : "Open DMX USB"} on ${port.path}`;
    port.on("error", error => log(`${this.name}: ${error.message}`));
  }

  send(universe: Uint8Array): void {
    if (this.busy || !this.port.isOpen) return;
    this.busy = true;
    const done = (error?: Error | null) => {
      this.busy = false;
      if (error) this.log(`${this.name}: ${error.message}`);
    };
    if (this.pro) {
      this.port.write(enttecProPacket(universe), done);
      return;
    }
    // Open DMX: the PC makes the DMX break itself, then sends start code 0 and the 512 channels at 250 kbaud.
    this.port.set({ brk: true }, error => {
      if (error) return done(error);
      this.port.set({ brk: false }, error2 => {
        if (error2) return done(error2);
        this.port.write(Buffer.concat([Buffer.from([0]), Buffer.from(universe)]), done);
      });
    });
  }

  close(): void {
    if (this.port.isOpen) this.port.close();
  }
}

export class LogOutput implements DmxOutput {
  readonly name = "the log";
  private last = 0;

  constructor(private log: (message: string) => void, private fixtures: LightsConfig["fixtures"], private everyMs = 1000) {}

  send(universe: Uint8Array): void {
    const now = Date.now();
    if (now - this.last < this.everyMs) return;
    this.last = now;
    this.log(this.fixtures.map(f => `${f.name} @${f.address}: ${[...universe.subarray(f.address - 1, f.address + 7)].join(" ")}`).join(" | "));
  }

  close(): void {}
}

const DMX_PORT = /ftdi|enttec|dmx|0403/i;

export async function dmxPorts(): Promise<{ path: string; label: string; likely: boolean }[]> {
  const ports = await SerialPort.list();
  return ports.map(p => {
    const label = [p.manufacturer, p.pnpId, p.vendorId && `VID ${p.vendorId}`].filter(Boolean).join(", ");
    return { path: p.path, label, likely: DMX_PORT.test(`${label} ${p.vendorId ?? ""}`) };
  });
}

function openSerial(path: string, pro: boolean): Promise<SerialPort> {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({ path, baudRate: pro ? 57600 : 250000, dataBits: 8, stopBits: 2, parity: "none", autoOpen: false });
    port.open(error => error ? reject(new Error(`Could not open ${path}: ${error.message}`)) : resolve(port));
  });
}

export async function openDmx(config: LightsConfig, log: (message: string) => void): Promise<DmxOutput | null> {
  switch (config.output) {
    case "none":
      return null;
    case "log":
      return new LogOutput(log, config.fixtures);
    case "artnet":
      return new ArtNetOutput(config.host ?? "255.255.255.255", config.universe ?? 0, log);
    case "open-dmx":
    case "enttec-pro": {
      let path = config.port ?? "auto";
      if (path === "auto") {
        const found = (await dmxPorts()).find(p => p.likely);
        if (!found) throw new Error("No USB-DMX adapter found. Plug it in, or run `npm run lights ports` and set \"port\" in lights.json");
        path = found.path;
      }
      const pro = config.output === "enttec-pro";
      return new SerialDmxOutput(await openSerial(path, pro), pro, log);
    }
  }
}
