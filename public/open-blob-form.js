import { html, LitElement } from "./lib/lit.min.js";

export class GetBlobForm extends LitElement {
  static properties = {
    hasBlob: { state: true },
  };

  createRenderRoot() {
    return this;
  }

  async submit(e) {
    e.preventDefault();

    const formData = new FormData(e.target);
    const sha256 = formData.get("sha256");

    this.hasBlob = await fetch("/" + sha256, { method: "HEAD" }).then((res) => res.ok);

    if (this.hasBlob) {
      window.open("/" + sha256, "_blank");
    }
  }

  renderResults() {
    return html`<div class="flex gap-2 flex-col max-h-xl overflow-auto">
      ${this.blobs.map(
        (blob) => html`
          <div class="flex gap-2">
            <a href=${blob.url} class="hover:underline" target="_blank">${blob.sha256}</a>
          </div>
        `,
      )}
    </div>`;
  }

  renderForm() {
    return html`<form class="gap-2" @submit="${this.submit}">
      <label class="text-sm font-bold text-gray-500 tracking-wide flex flex-col">
        <span class="block">View Blob (sha256)</span>
        <div class="flex gap-2">
          <input name="sha256" type="text" class="rounded-md border-2 w-full p-2 h-10" required />
          <button
            type="submit"
            class="flex bg-blue-500 text-gray-100 py-2 px-4 rounded-md tracking-wide font-semibold hover:bg-blue-600 cursor-pointer transition ease-in duration-300"
          >
            Open
          </button>
        </div>
      </label>
      ${this.hasBlob === false ? html`<p class="text-red-500 mb-4">Blob missing</p>` : null}
    </form>`;
  }

  render() {
    if (this.blob) {
      return this.renderResults();
    }

    return this.renderForm();
  }
}
customElements.define("get-blob-form", GetBlobForm);
