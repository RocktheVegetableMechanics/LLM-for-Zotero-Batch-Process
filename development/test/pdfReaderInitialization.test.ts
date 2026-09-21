import { strict as assert } from "node:assert";
import { waitForPdfDocument } from "../src/agent/services/pdfPageService";

describe("PDF reader initialization", function () {
  this.timeout(10000);
  it("waits for a cold reader that initializes after 2.2 seconds", async () => {
    const reader: any = {};
    const application = { pdfDocument: {} };
    const timer = setTimeout(() => {
      reader._internalReader = {
        _primaryView: { _iframeWindow: { PDFViewerApplication: application } },
      };
    }, 2300);
    try {
      assert.equal(await waitForPdfDocument(reader), application);
    } finally {
      clearTimeout(timer);
    }
  });
  it("still stops waiting when no PDF document becomes available", async () => {
    const started = Date.now();
    assert.equal(await waitForPdfDocument({}, 50), null);
    assert.ok(Date.now() - started < 1000);
  });
});
