import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compositeData,
  customerDeliveryEan,
  customerNoFrom7,
  decodeCset82,
  ean13From,
  encodeCset82,
  gs1CheckDigit,
  isValidGtin,
  renderCustomerIndicator,
  renderEan13,
} from "../lib/barcodes";

test("GS1 check digits", () => {
  assert.equal(gs1CheckDigit("5245165"), 2);
  assert.equal(customerNoFrom7(5245165), "52451652");
  assert.ok(isValidGtin("4006381333931", 13));
  assert.ok(!isValidGtin("52451658", 8));
  const e = ean13From("21", 42);
  assert.equal(e.length, 13);
  assert.ok(isValidGtin(e, 13));
  assert.ok(isValidGtin(customerDeliveryEan("21", "52451652"), 13));
});

test("umlauts survive the composite payload", () => {
  const name = "Herbert Müller - Strandleben GmbH";
  const enc = encodeCset82(name);
  assert.equal(enc, "Herbert_M%C3%BCller_-_Strandleben_GmbH");
  assert.equal(decodeCset82(enc), name);
  assert.equal(decodeCset82(encodeCset82("Groß & Söhne (Lager_2) 100%")), "Groß & Söhne (Lager_2) 100%");
  assert.ok(compositeData(name).startsWith("(91)"));
});

test("renders EAN-13 and EAN-8 composite", async () => {
  const png = (await renderEan13(ean13From("21", 1), "png")) as Buffer;
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  const svg = (await renderCustomerIndicator("52451652", "Herbert Müller - Strandleben GmbH", "svg")) as string;
  assert.ok(svg.startsWith("<svg"));
  const long = (await renderCustomerIndicator("52451652", "Ä".repeat(200), "png")) as Buffer;
  assert.ok(long.length > 100);
});
