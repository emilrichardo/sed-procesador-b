const sharp = require("sharp");
const fs = require("fs-extra");

async function test() {
  try {
    // Create a dummy PDF buffer (not real PDF, but header enough?)
    // Actually sharp needs a real file.
    // I will try to inspect sharp capabilities.
    const console = require("console");

    // Check if 'pdf' is in format list
    // sharp.format is not a method.
    // We can check sharp.versions
    console.log(JSON.stringify(sharp.versions, null, 2));

    // or try creating an image from vector
    // Standard sharp prebuilds typically DO NOT support PDF.
    // They support SVG.

    console.log("Sharp test done");
  } catch (e) {
    console.error(e);
  }
}
test();
