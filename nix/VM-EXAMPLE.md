# Blossom NixOS VM example

The repository flake exposes `nixosConfigurations.blossom-vm` as a complete, bootable NixOS configuration. It imports `nixosModules.default` from
[`module.nix`](./module.nix) and configures a local-storage Blossom server.

## Build and run locally

Build the QEMU VM from the repository root:

```sh
nix build path:.#example-vm
```

The explicit `path:.` form includes untracked files while developing the example. After `nix/example-vm.nix` has been added to Git, the shorter
`nix build .#example-vm` works as well.

Start it in a terminal (quit QEMU with <kbd>Ctrl-a</kbd>, then <kbd>x</kbd>):

```sh
result/bin/run-blossom-vm-vm -nographic
```

Once systemd reports that the VM has reached its target, open <http://localhost:3000> or check it from another terminal:

```sh
curl --fail http://localhost:3000/
```

The VM stores its writable disk in `blossom-vm.qcow2` in the directory from which it is launched. Reusing that file preserves `/var/lib/blossom-server` between
boots. Delete the file when you want a clean demonstration VM.

## Deploy to an existing NixOS machine

The same configuration can be evaluated and activated remotely with `nixos-rebuild`. Replace the host below with a machine on which root SSH access is already
configured:

```sh
nixos-rebuild switch \
  --flake path:.#blossom-vm \
  --target-host root@blossom.example.com \
  --build-host root@blossom.example.com
```

For a real deployment, copy [`example-vm.nix`](./example-vm.nix) into your own NixOS flake, remove the QEMU-only `virtualisation` block, add the target's
hardware configuration, require upload authentication, and set `publicDomain` to its externally visible hostname. A minimal consumer looks like this:

```nix
{
  inputs.blossom-server.url = "github:hzrd149/blossom-server";

  outputs = { nixpkgs, blossom-server, ... }: {
    nixosConfigurations.my-host = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        blossom-server.nixosModules.default
        ./configuration.nix
        {
          services.blossom-server = {
            enable = true;
            openFirewall = true;
            settings = {
              host = "0.0.0.0";
              publicDomain = "blossom.example.com";
              storage.backend = "local";
            };
          };
        }
      ];
    };
  };
}
```
