// A USB CDC-ACM serial adapter (CH343, CH9102 and other "USB modem" class chips found on
// ESP32-S3 DevKitC clones) driven over WebUSB, with the parts of the Web Serial SerialPort
// that esptool-js uses: open, close, readable, writable, setSignals, getInfo.
// Chrome on Android has WebUSB for wired devices but its Web Serial only lists Bluetooth ones.
// Requests as in the USB CDC PSTN spec: SET_LINE_CODING 0x20, SET_CONTROL_LINE_STATE 0x22.

export const CDC_FILTERS = [
  { vendorId: 0x1a86, productId: 0x55d3 }, // CH343
  { vendorId: 0x1a86, productId: 0x55d4 }, // CH9102
  { vendorId: 0x1a86, productId: 0x55d2 }, // CH342
];

const SET_LINE_CODING = 0x20;
const SET_CONTROL_LINE_STATE = 0x22;

export class CdcAcmPort {
  constructor(device) {
    this.device = device;
    this.readable = null;
    this.writable = null;
    this.dtr = false;
    this.rts = false;
    this.opened = false;
    this.rxBytes = 0;
    this.txBytes = 0;
    this.onLog = null; // (text) => void, for the page's log
  }

  log(t) {
    if (this.onLog) this.onLog(t);
  }

  getInfo() {
    return { usbVendorId: this.device.vendorId, usbProductId: this.device.productId };
  }

  async classOut(request, value, data) {
    const setup = { requestType: 'class', recipient: 'interface', request, value, index: this.commIface };
    const r = data ? await this.device.controlTransferOut(setup, data) : await this.device.controlTransferOut(setup);
    if (r.status !== 'ok') throw new Error(`CDC control 0x${request.toString(16)}: ${r.status}`);
  }

  async setBaud(baud) {
    const b = new DataView(new ArrayBuffer(7));
    b.setUint32(0, baud, true); // dwDTERate
    b.setUint8(4, 0);           // 1 stop bit
    b.setUint8(5, 0);           // no parity
    b.setUint8(6, 8);           // 8 data bits
    await this.classOut(SET_LINE_CODING, 0, b.buffer);
  }

  async writeModem() {
    await this.classOut(SET_CONTROL_LINE_STATE, (this.dtr ? 1 : 0) | (this.rts ? 2 : 0));
    this.log(`  [usb] DTR=${this.dtr ? 1 : 0} RTS=${this.rts ? 1 : 0}`);
  }

  async open({ baudRate = 115200 } = {}) {
    const d = this.device;
    if (!d.opened) await d.open();
    if (d.configuration === null) await d.selectConfiguration(1);
    const ifs = d.configuration.interfaces;
    const comm = ifs.find((i) => i.alternate.interfaceClass === 0x02) || ifs[0];
    const data = ifs.find((i) => i.alternate.interfaceClass === 0x0a);
    if (!data) throw new Error('CDC data interface not found');
    this.commIface = comm.interfaceNumber;
    this.dataIface = data.interfaceNumber;
    for (const i of [comm, data]) if (!i.claimed) await d.claimInterface(i.interfaceNumber);
    const eps = data.alternate.endpoints.filter((e) => e.type === 'bulk');
    this.epIn = eps.find((e) => e.direction === 'in').endpointNumber;
    this.epOut = eps.find((e) => e.direction === 'out').endpointNumber;
    this.log(`  [usb] CDC-ACM interfaces ${this.commIface}/${this.dataIface}, endpoints in ${this.epIn} out ${this.epOut}, ${baudRate} baud`);

    await this.setBaud(baudRate);
    await this.writeModem();

    this.opened = true;
    const port = this;
    this.readable = new ReadableStream({
      async pull(controller) {
        while (port.opened) {
          let r;
          try {
            r = await d.transferIn(port.epIn, 4096);
          } catch (e) {
            if (!port.opened) break;
            controller.error(e);
            return;
          }
          if (r.data && r.data.byteLength) {
            port.rxBytes += r.data.byteLength;
            controller.enqueue(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength));
            return;
          }
        }
        try {
          controller.close();
        } catch (e) { /* cancelled */ }
      },
      cancel() {},
    });
    this.writable = new WritableStream({
      async write(chunk) {
        port.txBytes += chunk.byteLength;
        const r = await d.transferOut(port.epOut, chunk);
        if (r.status !== 'ok') throw new Error('USB write: ' + r.status);
      },
    });
  }

  async setSignals({ dataTerminalReady, requestToSend } = {}) {
    if (dataTerminalReady !== undefined) this.dtr = dataTerminalReady;
    if (requestToSend !== undefined) this.rts = requestToSend;
    await this.writeModem();
  }

  async close() {
    this.opened = false;
    try {
      if (this.readable && !this.readable.locked) await this.readable.cancel();
    } catch (e) { /* already closed */ }
    this.readable = null;
    this.writable = null;
    for (const n of [this.dataIface, this.commIface]) {
      try {
        await this.device.releaseInterface(n);
      } catch (e) { /* not claimed */ }
    }
    try {
      await this.device.close();
    } catch (e) { /* already closed */ }
  }
}
