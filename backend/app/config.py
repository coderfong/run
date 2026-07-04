from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # "development" or "production". Production enforces config hygiene at
    # startup: a real JWT_SECRET and explicit CORS origins (see main.py).
    env: str = "development"

    database_url: str = "postgresql://run:run@localhost:5432/run"

    # JWT — MUST be overridden via env var in production.
    jwt_secret: str = "dev-only-change-me-in-prod"
    jwt_algorithm: str = "HS256"
    jwt_expire_days: int = 30
    # Clients silently refresh when this close to expiry (see /auth/refresh).
    jwt_refresh_window_days: int = 7

    # CORS — comma-separated list of allowed origins, or "*" to allow all
    # (dev only; production refuses to boot with "*").
    cors_origins: str = "*"

    # Sentry — no-op when unset.
    sentry_dsn: str = ""

    # App version reported by GET /version (override per deploy).
    app_version: str = "1.0.0"

    # Loop / polygon validation thresholds.
    # Tuned to filter out GPS jitter and trivial micro-loops.
    min_loop_points: int = 8           # minimum GPS samples before we look for a loop
    min_loop_area_m2: float = 200.0    # ignore loops smaller than this (anti-jitter)
    max_polygon_area_m2: float = 5_000_000.0  # 5 km^2 sanity cap
    closure_radius_m: float = 25.0     # if current point is within this of an earlier
                                       # segment, we treat it as a loop closure
    simplify_tolerance_m: float = 1.5  # douglas-peucker tolerance for cleanup
    max_speed_mps: float = 12.0        # ~43 km/h, drop GPS points exceeding this

    # ---- anti-cheat (validate_run) -------------------------------------
    # Flagged runs are shadow-flagged: the submitter sees normal success,
    # but their territories are hidden from everyone else. Never surface
    # which rule fired.
    cheat_max_mock_fraction: float = 0.05   # >5% mock-provider points -> flag
    cheat_teleport_speed_mps: float = 12.0  # sustained speed implying teleport
    cheat_teleport_min_points: int = 3      # ...over at least this many consecutive gaps
    cheat_pace_floor_s_per_km: float = 170.0  # 2:50/km — faster sustained is inhuman
    cheat_pace_window_m: float = 500.0      # rolling window for the pace floor
    cheat_stride_min_m: float = 0.5         # distance/steps below this -> flag
    cheat_stride_max_m: float = 2.0         # distance/steps above this -> flag
    cheat_clean_min_points: int = 120       # only long runs checked for "too clean"
    cheat_clean_spacing_cv: float = 0.05    # near-zero spacing variance = spoof-ish
    cheat_clean_accuracy_var: float = 0.01  # near-zero accuracy variance = spoof-ish

    # ---- rate limiting ---------------------------------------------------
    rate_limit_auth: str = "10/minute"
    rate_limit_submit_path: str = "60/minute"
    rate_limit_end_run: str = "6/minute"
    rate_limit_default: str = "120/minute"

    class Config:
        env_file = ".env"


settings = Settings()
