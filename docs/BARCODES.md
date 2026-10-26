# Barcodes

## Delivery code (EAN-13)

Every order gets an EAN-13 from the GS1 range for internal use ("restricted circulation", prefix
20–29, default `21`, Settings → Barcodes). Two modes – global, overridable per customer:

- **Varying per delivery**: a new code for every order (sequence).
- **Constant per customer**: every delivery of a customer carries the same code (derived from the
  customer number, or a fixed EAN-13 entered in the address book) – useful with reusable crates.

The code is printed on the delivery label (`Orders → Print labels`, `Tour → Labels (PDF)`).

## Customer indicator (EAN-8 composite, ISO/IEC 24723)

- **Linear part**: the customer number, an EAN-8 (7 digits + GS1 check digit; e.g. `5245165` →
  check digit `2` → `52451652`). Customer numbers are assigned automatically.
- **2D part** (CC-A or CC-B, chosen by length): GS1 application identifier `(91)` with the customer
  name, e.g. "Herbert Müller - Strandleben GmbH". GS1 character set 82 contains neither spaces nor
  umlauts, so spaces become `_` and other characters are UTF-8 percent-encoded:
  `(91)Herbert_M%C3%BCller_-_Strandleben_GmbH`. The apps and the backend decode it back.
  AI 91 holds at most 90 characters; longer names are shortened.

## Customer barcode sheet – proof of delivery without new labels

Print the one-page sheet once (address book → *Customer barcode sheet A4/A6*, the customer list or
*Tour → Customer barcodes*) and attach it at the delivery point (door, mailbox, goods entrance).
The driver scans it when delivering. Configure under **Settings → Barcodes → Barcode scan accepted
as proof of delivery** (customer barcode, order code, or both) and enable **Barcode scan** as
requirement for the outcomes you want (Settings → Outcomes & reasons). The app then only completes
those outcomes after a matching scan; the scanned values are stored in the delivery log.
