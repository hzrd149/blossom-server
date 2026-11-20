{
  pkgs,
  src,
  version,
}:
let
  inherit (pkgs) lib;

  adminBundleHash = "sha256-BOABMilIwt0G7mi8+zI3RA0+jKQL337hpL6SRyaG4ik=";
  adminBundle = (pkgs.buildDenoBundle {
    pname = "blossom-server-admin";
    inherit version src;
    configFile = "src/admin/client/deno.json";
    lockFile = "src/admin/client/deno.lock";
    entrypoint = "src/admin/client/main.tsx";
    bundleName = "client.js";
    bundleFlags = [
      "--minify"
      "--platform=browser"
    ];
    hash = adminBundleHash;
  }).overrideAttrs {
    postBuild = ''
      deno run --frozen --lock=src/admin/styles/deno.lock \
        --config=src/admin/styles/deno.json -A npm:@tailwindcss/cli@4.3.5 \
        -i src/admin/styles/input.css -o "$out/styles.css" --minify
    '';
  };

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

    hash = "sha256-ce/Bo4ij39GDuL0PL+Mh8mD+zallYK7zM35KyOH6cmA=";
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
    denoDepsHash = "sha256-VwV+WagVXen5iTNSWpJ3It0Owpd5lp2w4BPY1OUYgvE=";
    runtimeInputs = [ pkgs.ffmpeg ];
    runFlags = [
      "-P"
      "--vendor"
      "--node-modules-dir=auto"
    ];

    postPatch = ''
      mkdir -p public/admin
      cp ${adminBundle}/client.js public/admin/client.js
      cp ${adminBundle}/styles.css public/admin/styles.css
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
  inherit blossom-server clientBundle adminBundle styles;
  denoDeps = blossom-server.denoDeps;
}
