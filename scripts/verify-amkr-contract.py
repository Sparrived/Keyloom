from fastapi import FastAPI

from auto_model_key_router import agent_config
from auto_model_key_router.management_api import register_management_api
from inspect import signature
from dataclasses import fields

from auto_model_key_router.update import VersionCheckResult


REQUIRED_ROUTES = {
    ("GET", "/api/providers"),
    ("POST", "/api/providers"),
    ("PUT", "/api/providers/{provider_id}"),
    ("DELETE", "/api/providers/{provider_id}"),
    ("POST", "/api/providers/{provider_id}/keys"),
    ("PUT", "/api/providers/{provider_id}/keys/{key_name}"),
    ("DELETE", "/api/providers/{provider_id}/keys/{key_name}"),
    ("POST", "/api/providers/{provider_id}/pools"),
    ("PUT", "/api/providers/{provider_id}/pools/{pool_name}"),
    ("DELETE", "/api/providers/{provider_id}/pools/{pool_name}"),
    ("GET", "/api/routes"),
    ("POST", "/api/routes"),
    ("PUT", "/api/routes/{route_id}"),
    ("DELETE", "/api/routes/{route_id}"),
    ("POST", "/api/probes/keys"),
    ("POST", "/api/probes/pools"),
    ("GET", "/api/probes/{probe_id}"),
    ("POST", "/api/probes/{probe_id}/cancel"),
    ("POST", "/api/config/export"),
    ("POST", "/api/config/import"),
    ("GET", "/api/models"),
    ("GET", "/api/models/{model_id}"),
    ("PUT", "/api/models/{model_id}"),
    ("GET", "/api/unified-model"),
    ("PUT", "/api/unified-model"),
    ("DELETE", "/api/unified-model"),
}


def main() -> None:
    app = FastAPI()

    async def reload_config(_: object) -> None:
        return None

    register_management_api(app, reload_config)
    actual = {
        (method, route.path)
        for route in app.routes
        for method in (route.methods or set())
    }
    missing = sorted(REQUIRED_ROUTES - actual)
    if missing:
        details = ", ".join(f"{method} {path}" for method, path in missing)
        raise SystemExit(f"AMKR management API is incompatible with Keyloom: {details}")
    required_agent_exports = {
        "agent_display_name",
        "configure_agent",
        "get_agent_config_status",
        "rollback_agent",
    }
    missing_agent_exports = sorted(name for name in required_agent_exports if not hasattr(agent_config, name))
    if missing_agent_exports:
        raise SystemExit(f"AMKR agent integration API is incompatible with Keyloom: missing {', '.join(missing_agent_exports)}")
    if "mode" not in signature(agent_config.configure_agent).parameters:
        raise SystemExit("AMKR agent integration API is incompatible with Keyloom: configure_agent lacks mode")
    required_status_fields = {"target_path", "backup_available", "current_is_applied", "mode"}
    status_fields = set(getattr(agent_config.AgentConfigStatus, "__dataclass_fields__", {}))
    missing_status_fields = sorted(required_status_fields - status_fields)
    if missing_status_fields:
        raise SystemExit(f"AMKR agent integration API is incompatible with Keyloom: status lacks {', '.join(missing_status_fields)}")
    update_fields = {field.name for field in fields(VersionCheckResult)}
    missing_update_fields = sorted({"artifact_url", "artifact_sha256"} - update_fields)
    if missing_update_fields:
        raise SystemExit(f"AMKR update API is incompatible with Keyloom: metadata lacks {', '.join(missing_update_fields)}")
    print(f"AMKR management API contract PASS ({len(REQUIRED_ROUTES)} routes)")


if __name__ == "__main__":
    main()
