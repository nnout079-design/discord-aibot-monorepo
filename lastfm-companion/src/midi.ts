import { Output } from "@julusian/midi";
import { MidiOut } from "./player";

export function listOutputs(): string[] {
  return Output.getPortNames();
}

export function openOutput(name: string): { out: MidiOut; portName: string } {
  const ports = listOutputs();
  const index = ports.findIndex(port => port.toLowerCase().includes(name.toLowerCase()));
  if (index < 0) {
    throw new Error(`No MIDI output matching "${name}". Available: ${ports.length ? ports.join(", ") : "none (install loopMIDI or connect a device)"}`);
  }
  const output = new Output();
  output.openPort(index);
  return {
    portName: ports[index],
    out: {
      send: bytes => output.sendMessage(bytes),
      close: () => output.closePort()
    }
  };
}

export function logOutput(log: (message: string) => void): MidiOut {
  return {
    send: bytes => {
      if (bytes[0] !== 0xf8) log(`MIDI ${bytes.map(b => b.toString(16).padStart(2, "0")).join(" ")}`);
    },
    close: () => {}
  };
}
