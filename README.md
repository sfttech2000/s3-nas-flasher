# S3-NAS web installer

Installs S3-NAS (a small network file server: a USB flash drive or hard disk on an ESP32-S3, with a
web file manager) on an ESP32-S3-WROOM-1 N16R8 DevKitC-1 board (two USB-C ports, COM and USB) from a
browser over USB: computers with Chrome or Edge (Web Serial), Android phones with Chrome and an OTG
cable (WebUSB, small CH343 / CH340 drivers).

firmware/boot.bin goes to 0x0 and firmware/app.bin to 0xe000, so the settings (NVS 0x9000-0xDFFF:
WiFi, web login) are kept; "erase" wipes the whole chip first. Files on the USB disk are never touched
by the installer. The page refuses boards that are not ESP32-S3 or have less than 16MB flash.
Installs go through this page only (no one-file image), so each one is counted.

Uses esptool-js 0.6.1 (Apache-2.0), vendored in mobile/esptool-js/ with its licence.
The firmware uses Espressif usb_host_msc (Apache-2.0). Made by tee & claude.
