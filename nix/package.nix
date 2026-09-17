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

  blossom-server = pkgs.buildDenoApplication {
    pname = "blossom-server";
    inherit version src;

    entrypoint = "main.ts";
    denoDepsHash = "sha256-Px6t1wQ5Yd2sXv2rQxHpfukkgMmPs3ib56YIteKXhrQ=";
    runtimeInputs = [ pkgs.ffmpeg ];
    runFlags = [ "-P" ];

    postPatch = ''
      client_bundle="${builtins.placeholder "out"}/share/blossom-server/public/client.js"
      substituteInPlace src/routes/landing.tsx \
        --replace-fail 'const CLIENT_BUNDLE_PATH = "./public/client.js";' \
                       "const CLIENT_BUNDLE_PATH = \"$client_bundle\";"

      cp ${clientBundle}/client.js public/client.js
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
  inherit blossom-server clientBundle;
  denoDeps = blossom-server.denoDeps;
}
