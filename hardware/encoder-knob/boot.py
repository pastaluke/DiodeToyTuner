# boot.py — define the custom HID device before USB enumerates.
# Vendor usage page 0xFF60 (QMK raw-HID convention): the OS ignores it,
# WebHID can claim it. Report: [int8 detent_delta, uint8 button_bits].
import usb_hid

KNOB_REPORT_DESCRIPTOR = bytes(
    (
        0x06, 0x60, 0xFF,  # Usage Page (Vendor 0xFF60)
        0x09, 0x61,        # Usage (0x61)
        0xA1, 0x01,        # Collection (Application)
        0x09, 0x62,        #   Usage (0x62)
        0x15, 0x81,        #   Logical Minimum (-127)
        0x25, 0x7F,        #   Logical Maximum (127)
        0x75, 0x08,        #   Report Size (8)
        0x95, 0x02,        #   Report Count (2)
        0x81, 0x02,        #   Input (Data, Var, Abs)
        0xC0,              # End Collection
    )
)

knob = usb_hid.Device(
    report_descriptor=KNOB_REPORT_DESCRIPTOR,
    usage_page=0xFF60,
    usage=0x61,
    report_ids=(0,),
    in_report_lengths=(2,),
    out_report_lengths=(0,),
)

usb_hid.enable((knob,))
