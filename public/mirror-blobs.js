import { html, LitElement } from "./lib/lit.min.js";
import { formatBytes, newExpirationValue, unixNow } from "./utils.js";

export class MirrorBlobs extends LitElement {
  static properties = {
    remoteBlobs: { state: true },
    localBlobs: { state: true },

    status: { state: true, type: String },
    progress: { state: true },

    server: { state: true, type: String },
    selected: { state: true },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.selected = [];
  }

  async fetchRemoteBlobs() {
    if (!this.server) return;

    const pubkey = await window.nostr.getPublicKey();

    this.status = "Signing...";
    const auth = await window.nostr.signEvent({
      kind: 24242,
      content: "List Blobs",
      created_at: unixNow(),
      tags: [
        ["t", "list"],
        ["expiration", newExpirationValue()],
        ["server", new URL("/", this.server).toString()],
      ],
    });

    this.status = "Fetching...";
    this.remoteBlobs = await fetch(new URL("/list/" + pubkey, this.server), {
      headers: { authorization: "Nostr " + btoa(JSON.stringify(auth)) },
    }).then((res) => res.json());

    this.status = undefined;
  }

  localAuth = null;
  async fetchLocalBlobs() {
    this.pubkey = await window.nostr?.getPublicKey();
    if (!this.pubkey) return;

    this.status = "Signing...";

    this.localAuth = await window.nostr.signEvent({
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

    this.localBlobs = await fetch("/list/" + this.pubkey, {
      headers: { authorization: "Nostr " + btoa(JSON.stringify(this.localAuth)) },
    }).then((res) => res.json());

    this.status = undefined;
  }

  async submit(e) {
    e.preventDefault();

    await this.fetchLocalBlobs();
    await this.fetchRemoteBlobs();
  }

  serverChange(e) {
    this.server = e.target.value;
  }

  renderForm() {
    return html`<form class="space-y-4 ml-auto" @submit="${this.submit}">
      <label class="text-sm font-bold text-gray-500 tracking-wide flex flex-col">
        <div class="flex gap-2">
          <input
            name="server"
            type="url"
            class="rounded-md border-2 w-full p-2 h-10 min-w-20"
            .value="${this.server || ""}"
            @change="${this.serverChange}"
            placeholder="https://cdn.example.com"
            style="min-width: 18rem;"
            required
          />
          <button
            type="submit"
            class="flex bg-blue-500 text-gray-100 py-2 px-4 rounded-md tracking-wide font-semibold hover:bg-blue-600 cursor-pointer transition ease-in duration-300 flex-shrink-0"
          >
            List Blobs
          </button>
        </div>
      </label>
    </form>`;
  }

  selectAll() {
    const missingBlobs = this.remoteBlobs.filter((blob) => !this.localBlobs.some((b) => b.sha256 === blob.sha256));

    if (this.selected.length === missingBlobs.length) {
      this.selected = [];
    } else this.selected = missingBlobs.map((b) => b.sha256);
  }
  toggleSelection(sha256) {
    if (this.selected.includes(sha256)) {
      this.selected = this.selected.filter((s) => s !== sha256);
    } else this.selected = [...this.selected, sha256];
  }

  async mirrorBlobs() {
    const blobs = this.remoteBlobs.filter((blob) => this.selected.includes(blob.sha256));

    for (const blob of blobs) {
      this.progress = blobs.indexOf(blob) + 1;
      this.status = `Signing ${blob.sha256}`;

      // create auth event
      const auth = await window.nostr.signEvent({
        kind: 24242,
        content: "Mirror Blob",
        created_at: unixNow(),
        tags: [
          ["t", "upload"],
          ["x", blob.sha256],
          ["expiration", newExpirationValue()],
        ],
      });

      this.status = `Mirroring ${blob.sha256}`;
      await fetch("/mirror", {
        method: "PUT",
        body: JSON.stringify({ url: blob.url }),
        headers: { authorization: "Nostr " + btoa(JSON.stringify(auth)), "Content-Type": "application/json" },
      });
    }

    this.progress = undefined;
    this.status = undefined;

    this.selected = [];
    await this.fetchLocalBlobs();
  }

  renderContent() {
    if (!window.nostr) return html`<p class="text-red-500 text-lg text-center p-10">Missing window.nostr extension</p>`;

    if (this.progress !== undefined) {
      return html`
        <p>${this.progress}/${this.selected.length} - <span class="text-gray-500">${this.status}</span></p>
        <progress class="my-2" .value="${this.progress}" max="${this.selected.length}">
          ${((this.selected.length / this.progress) * 100).toFixed(2)}%
        </progress>
      `;
    } else if (this.status) {
      return html`<p class="my-5 text-center text-lg">${this.status}</p>`;
    } else if (this.remoteBlobs && this.localBlobs) {
      const missingBlobs = this.remoteBlobs.filter((blob) => !this.localBlobs.some((b) => b.sha256 === blob.sha256));

      if (missingBlobs.length === 0) {
        return html`<p class="text-green-500 text-lg text-center p-10">All blobs synced ✅</p>`;
      }

      return html`
        <div class="flex gap-2 py-2">
          <button
            class="text-md bg-blue-500 text-gray-100 py-1 px-3 rounded-md tracking-wide font-semibold hover:bg-blue-600 cursor-pointer transition ease-in duration-300 flex-shrink-0"
            @click="${this.selectAll}"
          >
            Select All
          </button>
          <button
            class="text-md bg-blue-500 text-gray-100 py-1 px-3 rounded-md tracking-wide font-semibold hover:bg-blue-600 cursor-pointer transition ease-in duration-300 flex-shrink-0 ml-auto"
            @click="${this.mirrorBlobs}"
          >
            Mirror Blobs
          </button>
        </div>
        ${this.renderBlobs(missingBlobs)}
      `;
    }

    return html`<p class="text-gray-500 text-lg text-center p-10">Select Blossom Server</p>`;
  }

  renderBlobs(blobs = []) {
    return html`<table class="table-auto overflow-hidden">
      <thead>
        <tr>
          <th></th>
          <th class="px-2">sha256</th>
          <th class="px-2 text-right">Type</th>
          <th class="px-2 text-right">Size</th>
        </tr>
      </thead>
      <tbody class="overflow-auto">
        ${blobs.map(
          (blob) => html`
            <tr class="whitespace-nowrap">
              <td>
                <input
                  type="checkbox"
                  .checked="${this.selected.includes(blob.sha256)}"
                  @change="${this.toggleSelection.bind(this, blob.sha256)}"
                />
              </td>
              <td class="px-2 overflow-hidden truncate font-mono" style="max-width: 10em">
                <a href=${blob.url} class="hover:underline" target="_blank">${blob.sha256}</a>
              </td>
              <td class="px-2 text-right" style="max-width: 5em">${blob.type}</td>
              <td class="px-2 text-right">${formatBytes(blob.size)}</td>
            </tr>
          `,
        )}
      </tbody>
    </table>`;
  }

  render() {
    return html`<div class="w-full p-4 bg-white rounded-xl flex flex-col overflow-hidden">
      <div class="flex gap-4 w-full items-flex-start flex-wrap">
        <h1 class="text-xl">Mirror blobs</h1>
        ${window.nostr && this.renderForm()}
      </div>

      ${this.renderContent()}

      <div class="flex mt-4 text-sm text-blue-400">
        <a href="#">back to upload</a>

        <a class="ml-auto" href="https://github.com/hzrd149/blossom">🌸 Blossom Spec</a>
      </div>
    </div>`;
  }
}
customElements.define("mirror-blobs", MirrorBlobs);
