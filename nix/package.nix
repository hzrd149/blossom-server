{
  pkgs,
  src,
  version,
}:
let
  inherit (pkgs) lib;

  clientBundle = pkgs.buildDenoBundle {
    pname = "blossom-server-client";
    inherit version src;

    configFile = "src/landing/client/deno.json";
    lockFile = "src/landing/client/deno.lock";
    entrypoint = "src/landing/client/index.tsx";
    bundleName = "client.js";

    bundleFlags = [
      "--minify"
      "--platform=browser"
    ];

    hash = "sha256-3aTe6unYpZZj/YBYEMQrXSqVZoqUfPI7W/Mb5FwGDjo=";
  };

  styles = pkgs.runCommand "blossom-server-styles-${version}.css" {
    nativeBuildInputs = [ pkgs.tailwindcss ];
  } ''
    cd ${src}
    tailwindcss \
      -c tailwind.config.js \
      -i src/landing/styles/input.css \
      -o "$out" \
      --minify
  '';

  blossom-server = pkgs.buildDenoApplication {
    pname = "blossom-server";
    inherit version src;

    entrypoint = "main.ts";
    denoDepsHash = "sha256-C4ACwnUpS3EqOfczefKQDi7HckZwGfRWbggeccuUQfs=";
    runtimeInputs = [ pkgs.ffmpeg ];
    runFlags = [ "-P" ];

    postPatch = ''
      cp ${clientBundle}/client.js public/client.js
      cp ${styles} public/styles.css
    '';

    meta = {
      description = "Deno-based Blossom blob storage server";
      homepage = "https://github.com/hzrd149/blossom-server";
      license = lib.licenses.mit;
    };
  };
in
{
  default = blossom-server;
  inherit blossom-server clientBundle styles;
  denoDeps = blossom-server.denoDeps;
}
