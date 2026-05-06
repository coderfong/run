from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://run:run@localhost:5432/run"

    # JWT — MUST be overridden via env var in production.
    jwt_secret: str = "dev-only-change-me-in-prod"
    jwt_algorithm: str = "HS256"
    jwt_expire_days: int = 30

    # CORS — comma-separated list of allowed origins, or "*" to allow all.
    cors_origins: str = "*"

    # Loop / polygon validation thresholds.
    # Tuned to filter out GPS jitter and trivial micro-loops.
    min_loop_points: int = 8           # minimum GPS samples before we look for a loop
    min_loop_area_m2: float = 200.0    # ignore loops smaller than this (anti-jitter)
    max_polygon_area_m2: float = 5_000_000.0  # 5 km^2 sanity cap
    closure_radius_m: float = 25.0     # if current point is within this of an earlier
                                       # segment, we treat it as a loop closure
    simplify_tolerance_m: float = 1.5  # douglas-peucker tolerance for cleanup
    max_speed_mps: float = 12.0        # ~43 km/h, drop GPS points exceeding this

    class Config:
        env_file = ".env"


settings = Settings()
