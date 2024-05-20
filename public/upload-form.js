import { html, LitElement } from "./lib/lit.min.js";
import { unixNow, newExpirationValue, getFileSha256, formatBytes } from "./utils.js";

import "./open-blob-form.js";

export class UploadForm extends LitElement {
  static properties = {
    selected: { state: true },
    status: { state: true, type: String },
  };

  createRenderRoot() {
    return this;
  }

  async upload(e) {
    e.preventDefault();
    if (!this.selected) return alert("Select file first");

    const file = this.selected;
    this.status = "Compute SHA256 hash...";
    const hash = await getFileSha256(file);

    this.status = "Signing...";

    // create auth event
    const auth = await window.nostr.signEvent({
      kind: 24242,
      content: "Authorize Upload",
      created_at: unixNow(),
      tags: [
        ["t", "upload"],
        ["x", hash],
        ["expiration", newExpirationValue()],
      ],
    });

    this.status = "Uploading...";
    await fetch("/upload", {
      method: "PUT",
      body: file,
      // attach Authorization: Nostr <base64> header to request
      headers: { authorization: "Nostr " + btoa(JSON.stringify(auth)) },
    }).then(async (res) => {
      if (res.ok) {
        const body = await res.json();

        this.selected = undefined;
        window.open(body.url, "_blank");
      } else alert(await res.text());
    });
    this.status = "Upload";
  }

  inputChange(e) {
    this.selected = e.target.files[0];
  }

  render() {
    const preview = !this.selected
      ? html`<div class="h-full w-full text-center flex flex-col items-center justify-center items-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="w-10 h-10 text-blue-400 group-hover:text-blue-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          <p class="pointer-none text-gray-500">
            <span class="text-sm">Drag and drop</span> files here <br />
            or <a href="" id="" class="text-blue-600 hover:underline">select a file</a> from your computer
          </p>
        </div>`
      : html`<p class="pointer-none text-gray-500 font-bold">${this.selected.name}</p>
          <p class="text-gray-500 text-sm">${formatBytes(this.selected.size)}</p>`;

    return html`<div class="w-full px-10 pt-10 pb-6 bg-white rounded-xl flex flex-col">
      <div class="text-center">
        <h1 class="mt-5 text-3xl font-bold text-gray-900">🌸 Blossom Server</h1>
        <p class="mt-2 text-sm text-gray-400">Blobs stored simply on mediaservers</p>
        <a class="text-sm text-blue-400" href="https://github.com/hzrd149/blossom-server">Github</a>
      </div>
      <form class="space-y-3" @submit="${this.upload}">
        <div class="grid grid-cols-1 space-y-2">
          <label class="text-sm font-bold text-gray-500 tracking-wide">Selected File</label>
          <div class="flex items-center justify-center w-full">
            <label
              class="flex flex-col rounded-lg border-4 border-dashed w-full h-50 p-10 group text-center cursor-pointer"
            >
              ${preview}
              <input name="blob" type="file" class="hidden" @change="${this.inputChange}" />
            </label>
          </div>
        </div>
        <div>
          <button
            type="submit"
            class="my-5 w-full flex justify-center bg-blue-500 text-gray-100 p-3 rounded-full tracking-wide font-semibold focus:outline-none focus:shadow-outline hover:bg-blue-600 shadow-lg cursor-pointer transition ease-in duration-300"
          >
            ${this.status || "Upload"}
          </button>
        </div>
      </form>

      <get-blob-form></get-blob-form>

      <div class="flex gap-4 mt-2">
        <a class="text-md text-blue-500" href="#list">List Blobs</a>
        <!-- <a class="text-md text-red-500" href="#delete">Request delete</a> -->
      </div>
      <a class="text-sm text-blue-400 ml-auto mt-4" href="https://github.com/hzrd149/blossom">🌸 Blossom Spec</a>
    </div>`;
  }
}
customElements.define("upload-form", UploadForm);
