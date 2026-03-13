import { html, LitElement } from "./lib/lit.min.js";
import { unixNow, newExpirationValue, formatBytes } from "./utils.js";

export class ListForm extends LitElement {
  static properties = {
    pubkey: { state: true },
    blobs: { state: true },
    status: { state: true, type: String },
  };

  createRenderRoot() {
    return this;
  }

  _auth = null;
  async submit(e) {
    e.preventDefault();

    const formData = new FormData(e.target);
    this.pubkey = formData.get("pubkey") || (await window.nostr?.getPublicKey());
    if (!this.pubkey) return;

    this.status = "Signing...";

    this._auth = await window.nostr.signEvent({
      kind: 24242,
      content: "List Blobs",
      created_at: unixNow(),
      tags: [
        ["t", "list"],
        ["expiration", newExpirationValue()],
        ["server", new URL(location.protocol + "//" + location.hostname).toString()],
      ],
    });

    this.status = "Fetching...";

    this.blobs = await fetch("/list/" + this.pubkey, {
      headers: { authorization: "Nostr " + btoa(JSON.stringify(this._auth)) },
    }).then((res) => res.json());

    this.status = undefined;
  }

  async refresh() {
    this.blobs = await fetch("/list/" + this.pubkey, {
      headers: { authorization: "Nostr " + btoa(JSON.stringify(this._auth)) },
    }).then((res) => res.json());
  }

  inputChange(e) {
    this.pubkey = e.target.files[0];
  }

  async pubkeyFromExtension(e) {
    e.preventDefault();

    this.pubkey = await window.nostr.getPublicKey();
  }

  async deleteBlob(blob) {
    const auth = await window.nostr.signEvent({
      kind: 24242,
      content: "Delete Item",
      created_at: unixNow(),
      tags: [
        ["t", "delete"],
        ["x", blob.sha256],
        ["expiration", newExpirationValue()],
      ],
    });

    await fetch("/" + blob.sha256, {
      method: "DELETE",
      headers: { authorization: "Nostr " + btoa(JSON.stringify(auth)) },
    }).then(async (res) => {
      if (res.ok) {
        alert("Blob deleted");
        await this.refresh();
      } else alert(await res.text());
    });
  }

  renderResults() {
    return html`<table class="table-auto overflow-hidden">
      <thead>
        <tr>
          <th class="px-2">sha256</th>
          <th class="px-2 text-right">Type</th>
          <th class="px-2 text-right">Size</th>
          <th class="px-2"></th>
        </tr>
      </thead>
      <tbody class="overflow-auto">
        ${this.blobs.map(
          (blob) => html`
            <tr class="whitespace-nowrap">
              <td class="px-2 overflow-hidden truncate font-mono" style="max-width: 10em">
                <a href=${blob.url} class="hover:underline" target="_blank">${blob.sha256}</a>
              </td>
              <td class="px-2 text-right" style="max-width: 5em">${blob.type}</td>
              <td class="px-2 text-right">${formatBytes(blob.size)}</td>
              <td class="px-2 text-right">
                <a
                  href="#"
                  class="text-red-500 hover:underline"
                  @click="${(e) => {
                    e.preventDefault();
                    this.deleteBlob(blob);
                  }}"
                >
                  Delete
                </a>
              </td>
            </tr>
          `,
        )}
      </tbody>
    </table>`;
  }

  renderForm() {
    return html`<form class="space-y-4 ml-auto" @submit="${this.submit}">
      <label class="text-sm font-bold text-gray-500 tracking-wide flex flex-col">
        <div class="flex gap-2">
          <input
            name="pubkey"
            type="text"
            class="rounded-md border-2 w-full p-2 h-10 min-w-20"
            @change="${this.inputChange}"
            .value="${this.pubkey || ""}"
            placeholder="Pubkey"
            style="min-width: 18rem;"
          />
          <button
            type="submit"
            class="flex bg-blue-500 text-gray-100 py-2 px-4 rounded-md tracking-wide font-semibold hover:bg-blue-600 cursor-pointer transition ease-in duration-300"
          >
            ${this.status || "List"}
          </button>
        </div>
        ${window.nostr &&
        html`<a href="#" class="text-blue-500 ml-auto" @click="${this.pubkeyFromExtension}">From Extension</a>`}
      </label>
    </form>`;
  }

  renderContent() {
    if (this.status) {
      return html`<p class="my-5 text-center text-lg">${this.status}</p>`;
    } else if (this.blobs) {
      if (this.blobs.length === 0) return html`<p class="text-gray-500 text-md text-center p-10">Set pubkey</p>`;

      return this.renderResults();
    }

    return html`<p class="text-gray-500 text-md text-center p-10">Set pubkey</p>`;
  }

  render() {
    if (this.status) {
      return html`<p class="my-5 text-center text-lg">${this.status}</p>`;
    }

    return html`<div class="w-full p-4 bg-white rounded-xl flex flex-col overflow-hidden">
      <div class="flex gap-4 w-full items-flex-start flex-wrap">
        <h1 class="text-xl">List blobs</h1>
        ${this.renderForm()}
      </div>

      ${this.renderContent()}

      <div class="flex mt-4 text-sm text-blue-400">
        <a href="#">back to upload</a>

        <a class="ml-auto" href="https://github.com/hzrd149/blossom">🌸 Blossom</a>
      </div>
    </div>`;
  }
}
customElements.define("list-blobs", ListForm);
