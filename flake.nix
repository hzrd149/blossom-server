{
  description = "Blossom Server - Deno-based Blossom blob storage server";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    deno2nix.url = "github:hzrd149/deno2nix";
    deno2nix.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    {
      self,
      nixpkgs,
      deno2nix,
    }:
    let
      systems = [
        "x86_64-linux"
      ];

      forAllSystems =
        f:
        nixpkgs.lib.genAttrs systems (
          system:
          f system (
            import nixpkgs {
              inherit system;
              overlays = [ deno2nix.overlays.default ];
            }
          )
        );

      # Exactly what the package build needs, listed explicitly so unrelated
      # files — planning notes, tests, .env files, `nix build` result symlinks,
      # generated public assets — can never change the derivation.
      src = nixpkgs.lib.fileset.toSource {
        root = ./.;
        fileset = nixpkgs.lib.fileset.unions [
          ./main.ts
          ./deno.json
          ./deno.lock
          ./tailwind.config.js
          ./src
          ./public/favicon.ico
        ];
      };
    in
    {
      nixosModules = {
        blossom-server = import ./nix/module.nix self;
        default = self.nixosModules.blossom-server;
      };

      packages = forAllSystems (
        system: pkgs:
        (import ./nix/package.nix {
          inherit pkgs src;
          version = (builtins.fromJSON (builtins.readFile ./deno.json)).version;
        })
        // {
          # `nix run .#vm` — a disposable Blossom demonstration VM.
          vm =
            (nixpkgs.lib.nixosSystem {
              modules = [
                { nixpkgs.hostPlatform = system; }
                "${nixpkgs}/nixos/modules/virtualisation/qemu-vm.nix"
                self.nixosModules.default
                ./nix/example-vm.nix
              ];
            }).config.system.build.vm;
        }
      );

      apps = forAllSystems (
        system: _pkgs: {
          default = {
            type = "app";
            program = "${self.packages.${system}.default}/bin/blossom-server";
            meta.description = "Run the Blossom Server package";
          };
        }
      );

      devShells = forAllSystems (
        _system: pkgs: {
          default = pkgs.mkShell {
            packages = [
              pkgs.deno
            ]
            ++ [ pkgs.ffmpeg ];

            shellHook = ''
              echo "Blossom Server dev shell"
              echo "  deno task build"
              echo "  deno task dev"
              echo "  nix build .#blossom-server"
            '';
          };
        }
      );

      checks = forAllSystems (
        system: _pkgs: {
          package = self.packages.${system}.default;
        }
      );
    };
}
