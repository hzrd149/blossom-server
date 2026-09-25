self:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.blossom-server;
  settingsFormat = pkgs.formats.yaml { };
  configFile = settingsFormat.generate "blossom-server.yml" cfg.settings;
in
{
  options.services.blossom-server = {
    enable = lib.mkEnableOption "Blossom blob storage server";

    package = lib.mkPackageOption self.packages.${pkgs.stdenv.hostPlatform.system} "blossom-server" { };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether to open the configured Blossom TCP port in the firewall.";
    };

    environmentFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      example = "/run/secrets/blossom-server.env";
      description = ''
        Environment file containing secrets referenced from settings using
        Blossom's environment variable interpolation. Do not put secrets
        directly in settings because the generated YAML is stored in the
        world-readable Nix store.
      '';
    };

    settings = lib.mkOption {
      type = settingsFormat.type;
      default = { };
      example = {
        publicDomain = "blobs.example.com";
        upload.requireAuth = true;
      };
      description = ''
        Blossom configuration rendered as YAML. Secret values should use
        placeholders such as `''${S3_SECRET_KEY}` and be supplied through
        environmentFile.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    services.blossom-server.settings = {
      host = lib.mkDefault "127.0.0.1";
      port = lib.mkDefault 3000;
      database.path = lib.mkDefault "/var/lib/blossom-server/sqlite.db";
      storage.local.dir = lib.mkDefault "/var/lib/blossom-server/blobs";
      media.tmpDir = lib.mkDefault "/var/lib/blossom-server/media-tmp";
    };

    networking.firewall.allowedTCPPorts = lib.optional cfg.openFirewall cfg.settings.port;

    systemd.services.blossom-server = {
      description = "Blossom blob storage server";
      documentation = [ "https://github.com/hzrd149/blossom-server" ];
      wantedBy = [ "multi-user.target" ];
      wants = [ "network-online.target" ];
      after = [ "network-online.target" ];

      environment = {
        DENO_DIR = "/var/cache/blossom-server/deno";
        BLOSSOM_REQUIRE_CONFIG = "1";
      };
      restartTriggers = [ configFile ];

      serviceConfig = {
        ExecStart = "${lib.getExe cfg.package} ${configFile}";
        Restart = "on-failure";
        RestartSec = 5;

        DynamicUser = true;
        StateDirectory = "blossom-server";
        CacheDirectory = "blossom-server";
        WorkingDirectory = "/var/lib/blossom-server";
        UMask = "0077";

        NoNewPrivileges = true;
        PrivateDevices = true;
        PrivateTmp = true;
        ProtectControlGroups = true;
        ProtectHome = true;
        ProtectKernelModules = true;
        ProtectKernelTunables = true;
        ProtectSystem = "strict";
        RestrictSUIDSGID = true;
      }
      // lib.optionalAttrs (cfg.environmentFile != null) {
        EnvironmentFile = cfg.environmentFile;
      };
    };
  };
}
