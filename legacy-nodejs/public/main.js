import { html, LitElement } from "./lib/lit.min.js";
import "./upload-form.js";
import "./list-blobs.js";
import "./mirror-blobs.js";

export class BlossomApp extends LitElement {
  static properties = {
    selected: { state: true },
    status: { state: true, type: String },
  };

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("hashchange", () => {
      this.requestUpdate();
    });
  }

  render() {
    const hash = location.hash;

    let content = "";
    switch (hash) {
      case "#list":
        content = html`<list-blobs class="z-10 sm:max-w-4xl w-full"></list-blobs>`;
        break;
      case "#mirror":
        content = html`<mirror-blobs class="z-10 sm:max-w-4xl w-full"></mirror-blobs>`;
        break;
      case "#upload":
      default:
        content = html`<upload-form class="z-10 sm:max-w-lg w-full"></upload-form>`;
        break;
    }

    return html` <div
      class="relative min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 bg-gray-500 bg-no-repeat bg-cover relative items-center"
    >
      <div class="absolute bg-black opacity-60 inset-0 z-0"></div>
      ${content}
    </div>`;
  }
}

customElements.define("blossom-app", BlossomApp);
