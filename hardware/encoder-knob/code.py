# code.py — EC11 rotary encoder(s) + push button(s) -> 2-byte HID reports.
# Report format (see boot.py): [int8 detent_delta, uint8 button_bits]
import time

import board
import digitalio
import rotaryio
import usb_hid

# (pin_a, pin_b, pin_switch) — add up to 4 tuples for a multi-knob box.
ENCODERS = [
    (board.GP2, board.GP3, board.GP4),
]

encoders = []
buttons = []
for pin_a, pin_b, pin_sw in ENCODERS:
    encoders.append(rotaryio.IncrementalEncoder(pin_a, pin_b))
    sw = digitalio.DigitalInOut(pin_sw)
    sw.direction = digitalio.Direction.INPUT
    sw.pull = digitalio.Pull.UP
    buttons.append(sw)

knob = None
for device in usb_hid.devices:
    if device.usage_page == 0xFF60:
        knob = device
        break
if knob is None:
    raise RuntimeError("boot.py HID device missing - copy boot.py and power-cycle")

last_positions = [enc.position for enc in encoders]
report = bytearray(2)

while True:
    delta = 0
    for i, enc in enumerate(encoders):
        pos = enc.position
        delta += pos - last_positions[i]
        last_positions[i] = pos

    button_bits = 0
    for i, sw in enumerate(buttons):
        if not sw.value:  # active-low
            button_bits |= 1 << i

    # clamp to int8
    delta = max(-127, min(127, delta))
    report[0] = delta & 0xFF
    report[1] = button_bits
    knob.send_report(report)
    time.sleep(0.01)  # 100 Hz
