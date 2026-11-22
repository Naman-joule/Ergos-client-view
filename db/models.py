"""SQLAlchemy 2.0 models for the ergOS client view reporting database (Supabase).

Mirrors db/migrations/001_schema.sql. The SQL migrations stay the source of truth: they also
create the ergos_view_app role, grants, helper functions and RLS policies, which these models
don't describe. Use these models to read the data (scripts, notebooks, a FastAPI service), not
to create the schema; `Base.metadata.create_all()` would give you tables without tenant isolation.

    pip install "sqlalchemy>=2.0.21" "psycopg[binary]>=3.1"

    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import Session
    from models import Plant

    engine = create_engine("postgresql+psycopg://postgres.<ref>:<pw>@aws-1-ap-south-1.pooler.supabase.com:5432/postgres")
    with Session(engine) as s:
        for p in s.scalars(select(Plant).order_by(Plant.name)):
            print(p.plant_id, p.name, p.client.name)

Connecting as the owner bypasses RLS and sees every client. To read as a user, connect as
ergos_view_app and, inside each transaction, run:
    s.execute(text("SELECT set_config('app.user_id', :id, true)"), {"id": str(user_id)})

Synced tables (marked SYNCED) keep the ergOS ids as primary keys and are written only by the
sync job. App-owned tables use identity keys.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, Date, DateTime, Double, ForeignKey, Identity, Index,
    Integer, Numeric, String, Text, Time, UniqueConstraint, func, text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

TZ = DateTime(timezone=True)
N18 = Numeric(18, 4)


class Base(DeclarativeBase):
    pass


class SyncedTimestamps:
    created_at: Mapped[Optional[dt.datetime]] = mapped_column(TZ, server_default=func.now())
    updated_at: Mapped[Optional[dt.datetime]] = mapped_column(TZ, server_default=func.now())


class AppTimestamps:
    created_at: Mapped[dt.datetime] = mapped_column(TZ, nullable=False, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(TZ, nullable=False, server_default=func.now())


def block_check(col: str, name: str) -> CheckConstraint:
    return CheckConstraint(f"{col} BETWEEN 1 AND 96", name=name)


# =============================================================================================
# Tenancy (SYNCED)
# =============================================================================================
class Client(SyncedTimestamps, Base):
    __tablename__ = "client"

    client_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    email: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    key_contact_person: Mapped[Optional[str]] = mapped_column(String(200))
    contact_number: Mapped[Optional[str]] = mapped_column(String(20))
    logo_url: Mapped[Optional[str]] = mapped_column(String(500))
    alias_name: Mapped[Optional[str]] = mapped_column(String(100))
    is_active: Mapped[Optional[bool]] = mapped_column(Boolean)

    plants: Mapped[list[Plant]] = relationship(back_populates="client")
    dashboard_configs: Mapped[list[DashboardConfig]] = relationship(back_populates="client")


class PlantType(Base):
    __tablename__ = "plant_type"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    type: Mapped[Optional[str]] = mapped_column(String(50))          # consumer / generator
    sub_type: Mapped[Optional[str]] = mapped_column(String(50))      # cement, solar, flexi_packaging, ...
    description: Mapped[Optional[str]] = mapped_column(String(200))

    plants: Mapped[list[Plant]] = relationship(back_populates="plant_type")


class Plant(SyncedTimestamps, Base):
    __tablename__ = "plant"
    __table_args__ = (Index("plant_client_id_idx", "client_id"),)

    plant_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    client_id: Mapped[Optional[int]] = mapped_column(ForeignKey("client.client_id"))
    plant_type_id: Mapped[Optional[int]] = mapped_column(ForeignKey("plant_type.id"))
    name: Mapped[Optional[str]] = mapped_column(String(200), unique=True)
    state: Mapped[str] = mapped_column(String(100), nullable=False)
    discom: Mapped[Optional[str]] = mapped_column(String(100))
    connected_load: Mapped[Optional[float]] = mapped_column(Double)            # MW
    voltage_level: Mapped[Optional[str]] = mapped_column(String(50))           # 33_kv, 66_kv, 132_kv
    category_code: Mapped[Optional[str]] = mapped_column(String(50))
    category_name: Mapped[Optional[str]] = mapped_column(String(100))
    ct_pt_ratio: Mapped[Optional[str]] = mapped_column(String(20))
    energy_multiplier: Mapped[Optional[float]] = mapped_column(Double, server_default=text("1.0"))
    iex_contract_limit_kwh: Mapped[Optional[float]] = mapped_column(Double)
    is_auto_trading_enabled: Mapped[Optional[bool]] = mapped_column(Boolean, server_default=text("false"))
    is_active: Mapped[Optional[bool]] = mapped_column(Boolean, server_default=text("true"))

    client: Mapped[Optional[Client]] = relationship(back_populates="plants")
    plant_type: Mapped[Optional[PlantType]] = relationship(back_populates="plants")


# =============================================================================================
# RBAC (app-owned)
# =============================================================================================
class Role(AppTimestamps, Base):
    __tablename__ = "role"

    id: Mapped[int] = mapped_column(Integer, Identity(always=False), primary_key=True)
    name: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)   # admin, manager, client_user

    permissions: Mapped[list[Permission]] = relationship(secondary="role_permission", viewonly=True)
    users: Mapped[list[User]] = relationship(back_populates="role")


class Permission(AppTimestamps, Base):
    __tablename__ = "permission"

    permission_id: Mapped[int] = mapped_column(Integer, Identity(always=False), primary_key=True)
    permission_name: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)


class RolePermission(AppTimestamps, Base):
    __tablename__ = "role_permission"
    __table_args__ = (UniqueConstraint("role_id", "permission_id"),)

    id: Mapped[int] = mapped_column(Integer, Identity(always=False), primary_key=True)
    role_id: Mapped[int] = mapped_column(ForeignKey("role.id"), nullable=False)
    permission_id: Mapped[int] = mapped_column(ForeignKey("permission.permission_id"), nullable=False)


class User(AppTimestamps, Base):
    """Table "user" (a reserved word; SQLAlchemy quotes it). The app role can't read it:
    password hashes are only reachable through app_auth_lookup()."""
    __tablename__ = "user"
    __table_args__ = (Index("user_email_lower_idx", func.lower(text("email")), unique=True),)

    id: Mapped[int] = mapped_column(Integer, Identity(always=False), primary_key=True)
    email: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)       # bcrypt
    role_id: Mapped[Optional[int]] = mapped_column(ForeignKey("role.id"))
    is_active: Mapped[Optional[bool]] = mapped_column(Boolean, server_default=text("true"))
    last_reset: Mapped[Optional[dt.datetime]] = mapped_column(TZ)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("user.id"))

    role: Mapped[Optional[Role]] = relationship(back_populates="users")
    clients: Mapped[list[Client]] = relationship(secondary="user_client_map", viewonly=True)
    plants: Mapped[list[Plant]] = relationship(secondary="user_plant_map", viewonly=True)


class UserClientMap(AppTimestamps, Base):
    __tablename__ = "user_client_map"
    __table_args__ = (UniqueConstraint("user_id", "client_id"),)

    id: Mapped[int] = mapped_column(Integer, Identity(always=False), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    client_id: Mapped[int] = mapped_column(ForeignKey("client.client_id"), nullable=False)


class UserPlantMap(AppTimestamps, Base):
    """Rows here narrow a user to these plants of their client (no rows = all of the client's plants)."""
    __tablename__ = "user_plant_map"
    __table_args__ = (UniqueConstraint("user_id", "plant_id"),)

    id: Mapped[int] = mapped_column(Integer, Identity(always=False), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    plant_id: Mapped[int] = mapped_column(ForeignKey("plant.plant_id"), nullable=False)
    user_role: Mapped[str] = mapped_column(String(50), nullable=False, server_default=text("'viewer'"))


# =============================================================================================
# Lookups and plant configuration (SYNCED)
# =============================================================================================
class Market(Base):
    __tablename__ = "markets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    name: Mapped[Optional[str]] = mapped_column(String(50))              # IEX, PXIL

    market_types: Mapped[list[MarketType]] = relationship(back_populates="market")


class MarketType(Base):
    __tablename__ = "market_types"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    market_id: Mapped[Optional[int]] = mapped_column(ForeignKey("markets.id"))
    name: Mapped[Optional[str]] = mapped_column(String(50))              # DAM, GDAM, RTM
    start_time: Mapped[Optional[str]] = mapped_column(String(50))
    end_time: Mapped[Optional[str]] = mapped_column(String(50))
    result_time: Mapped[Optional[str]] = mapped_column(String(50))

    market: Mapped[Optional[Market]] = relationship(back_populates="market_types")


class PlantGenConMapping(SyncedTimestamps, Base):
    """Captive generator (source, e.g. solar) feeding a consumer plant (target)."""
    __tablename__ = "plant_gen_con_mapping"
    __table_args__ = (UniqueConstraint("source_plant_id", "target_plant_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    source_plant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("plant.plant_id"))
    target_plant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("plant.plant_id"))
    s_t_ratio: Mapped[float] = mapped_column(Double, nullable=False)
    source_capacity: Mapped[Optional[float]] = mapped_column(Double)
    target_capacity: Mapped[Optional[float]] = mapped_column(Double)
    is_active: Mapped[Optional[bool]] = mapped_column(Boolean)
    is_banking_enabled: Mapped[Optional[bool]] = mapped_column(Boolean)

    source_plant: Mapped[Optional[Plant]] = relationship(foreign_keys=[source_plant_id])
    target_plant: Mapped[Optional[Plant]] = relationship(foreign_keys=[target_plant_id])


class PlantOpenAccessCharges(SyncedTimestamps, Base):
    __tablename__ = "plant_open_access_charges"
    __table_args__ = (UniqueConstraint("portfolio_id", "effective_from"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    plant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("plant.plant_id"))
    portfolio_id: Mapped[str] = mapped_column(String(64), nullable=False)
    effective_from: Mapped[dt.date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[Optional[dt.date]] = mapped_column(Date)
    distribution_loss_pct: Mapped[Optional[Decimal]] = mapped_column(Numeric, server_default=text("3.0"))
    ctu_loss_pct: Mapped[Optional[Decimal]] = mapped_column(Numeric, server_default=text("3.95"))
    stu_loss_pct: Mapped[Optional[Decimal]] = mapped_column(Numeric, server_default=text("3.18"))
    css_rate_per_kwh: Mapped[Optional[Decimal]] = mapped_column(Numeric, server_default=text("0.49"))
    electricity_duty_pct: Mapped[Optional[Decimal]] = mapped_column(Numeric, server_default=text("7.5"))
    ctu_rate_per_mwh: Mapped[Optional[Decimal]] = mapped_column(Numeric)
    stu_rate_per_mwh: Mapped[Optional[Decimal]] = mapped_column(Numeric)
    distribution_rate_per_mwh: Mapped[Optional[Decimal]] = mapped_column(Numeric)
    sldc_charge: Mapped[Optional[Decimal]] = mapped_column(Numeric)
    fees_rate_per_mwh: Mapped[Optional[Decimal]] = mapped_column(Numeric)
    igst_pct: Mapped[Optional[Decimal]] = mapped_column(Numeric, server_default=text("18.0"))
    nldc_app_fee: Mapped[Optional[Decimal]] = mapped_column(Numeric)

    plant: Mapped[Optional[Plant]] = relationship()


class StateGridDiscomTariff(SyncedTimestamps, Base):
    """DISCOM ToD tariff per plant, month and 15-minute block (₹/kWh)."""
    __tablename__ = "state_grid_discom_tariff"
    __table_args__ = (
        UniqueConstraint("plant_id", "state", "year", "month", "block", "tod_type"),
        block_check("block", "state_grid_discom_tariff_block_check"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    plant_id: Mapped[int] = mapped_column(ForeignKey("plant.plant_id"), nullable=False)
    country: Mapped[str] = mapped_column(String(100), nullable=False)
    state: Mapped[str] = mapped_column(String(100), nullable=False)
    discom: Mapped[str] = mapped_column(String(100), nullable=False)
    category_name: Mapped[str] = mapped_column(String(100), nullable=False)
    category_code: Mapped[str] = mapped_column(String(50), nullable=False)
    year: Mapped[Optional[int]] = mapped_column(Integer)
    month: Mapped[Optional[int]] = mapped_column(Integer)
    block: Mapped[Optional[int]] = mapped_column(Integer)
    tod_type: Mapped[Optional[str]] = mapped_column(String(20))         # PEAK / OFFPEAK / NORMAL
    tariff_33_kv: Mapped[Optional[float]] = mapped_column(Double)
    tariff_66_kv: Mapped[Optional[float]] = mapped_column(Double)
    tariff_132_kv: Mapped[Optional[float]] = mapped_column(Double)
    electricity_duty: Mapped[Optional[float]] = mapped_column(Double)
    fppca_charge: Mapped[Optional[float]] = mapped_column(Double)

    plant: Mapped[Plant] = relationship()


class StateGridSolarTariff(SyncedTimestamps, Base):
    __tablename__ = "state_grid_solar_tariff"
    __table_args__ = (
        UniqueConstraint("plant_id", "state", "year", "month", "block", "tod_type"),
        block_check("block", "state_grid_solar_tariff_block_check"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    plant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("plant.plant_id"))
    state: Mapped[Optional[str]] = mapped_column(String(100))
    year: Mapped[Optional[int]] = mapped_column(Integer)
    month: Mapped[Optional[int]] = mapped_column(Integer)
    block: Mapped[Optional[int]] = mapped_column(Integer)
    tod_type: Mapped[Optional[str]] = mapped_column(String(20))
    tod_price: Mapped[float] = mapped_column(Double, nullable=False)


# =============================================================================================
# Today page data (SYNCED, 15-minute)
# =============================================================================================
class PlantProcessedMeterData(SyncedTimestamps, Base):
    """One row per plant per 15-minute reading. kwh_delta x 4 = kW. meter_timestamp marks the
    END of the interval unless METER_TS_CONVENTION=start."""
    __tablename__ = "plant_processed_meter_data"
    __table_args__ = (
        UniqueConstraint("plant_id", "meter_timestamp"),
        Index("ppmd_plant_date_idx", "plant_id", "date"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    plant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("plant.plant_id"))
    date: Mapped[Optional[dt.date]] = mapped_column(Date)
    meter_timestamp: Mapped[Optional[dt.datetime]] = mapped_column(TZ)
    kwh: Mapped[Optional[float]] = mapped_column(Double)               # cumulative register
    kwh_delta: Mapped[Optional[float]] = mapped_column(Double)         # interval kWh
    kvah: Mapped[Optional[float]] = mapped_column(Double)
    cumulative_pf: Mapped[Optional[float]] = mapped_column(Double)
    flags: Mapped[Optional[str]] = mapped_column(String(20))           # real / interpolated / missing

    plant: Mapped[Optional[Plant]] = relationship()


class TradingResult(SyncedTimestamps, Base):
    __tablename__ = "trading_result"
    __table_args__ = (UniqueConstraint("plant_id", "date", "market_type_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    plant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("plant.plant_id"))
    date: Mapped[Optional[dt.date]] = mapped_column(Date)
    market_type_id: Mapped[Optional[int]] = mapped_column(ForeignKey("market_types.id"))
    result_data: Mapped[Optional[Any]] = mapped_column(JSONB)

    plant: Mapped[Optional[Plant]] = relationship()
    market_type: Mapped[Optional[MarketType]] = relationship()
    blocks: Mapped[list[TradingResultBlock]] = relationship(
        back_populates="trading_result", cascade="all, delete-orphan", passive_deletes=True,
        order_by="TradingResultBlock.block_no",
    )


class TradingResultBlock(SyncedTimestamps, Base):
    """Cleared quantity per block. cleared_price above 100 is ₹/MWh (÷1000 for ₹/kWh)."""
    __tablename__ = "trading_result_block"
    __table_args__ = (
        UniqueConstraint("trading_result_id", "block_no"),
        Index("trb_plant_date_block_idx", "plant_id", "date", "block_no"),
        block_check("block_no", "trading_result_block_block_no_check"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    trading_result_id: Mapped[Optional[int]] = mapped_column(ForeignKey("trading_result.id", ondelete="CASCADE"))
    plant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("plant.plant_id"))
    date: Mapped[Optional[dt.date]] = mapped_column(Date)
    block_no: Mapped[Optional[int]] = mapped_column(Integer)
    cleared_quantity_mw: Mapped[Optional[float]] = mapped_column(Double)     # MW
    cleared_quantity: Mapped[Optional[float]] = mapped_column(Double)        # kWh
    cleared_price: Mapped[Optional[float]] = mapped_column(Double)
    landed_cost: Mapped[Optional[float]] = mapped_column(Double)
    landed_cost_rs_per_kwh: Mapped[Optional[float]] = mapped_column(Double)
    portfolio_id: Mapped[Optional[str]] = mapped_column(String(64))
    type_: Mapped[Optional[str]] = mapped_column("type_", String(10))       # BUY / SELL

    trading_result: Mapped[Optional[TradingResult]] = relationship(back_populates="blocks")


class PrebidPlan(SyncedTimestamps, Base):
    __tablename__ = "prebid_plan"
    __table_args__ = (UniqueConstraint("date", "plant_id", "market_type", "exhange_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    plant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("plant.plant_id"))
    date: Mapped[Optional[dt.date]] = mapped_column(Date)
    market_type: Mapped[Optional[str]] = mapped_column(String(20))
    exhange_name: Mapped[Optional[str]] = mapped_column(String(20))         # sic: matches ergOS
    prebid_plan_data: Mapped[Any] = mapped_column(JSONB, nullable=False)

    plant: Mapped[Optional[Plant]] = relationship()


class Banking(SyncedTimestamps, Base):
    __tablename__ = "banking"
    __table_args__ = (
        UniqueConstraint("date", "block", "plant_id"),
        Index("banking_plant_date_idx", "plant_id", "date"),
        block_check("block", "banking_block_check"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    plant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("plant.plant_id"))
    date: Mapped[Optional[dt.date]] = mapped_column(Date)
    block: Mapped[Optional[int]] = mapped_column(Integer)
    charge: Mapped[Optional[float]] = mapped_column(Double)
    discharge: Mapped[Optional[float]] = mapped_column(Double)
    adjusted_discharge: Mapped[Optional[float]] = mapped_column(Double)
    soc: Mapped[Optional[float]] = mapped_column(Double)
    peak_balance: Mapped[Optional[float]] = mapped_column(Double)
    normal_balance: Mapped[Optional[float]] = mapped_column(Double)
    offpeak_balance: Mapped[Optional[float]] = mapped_column(Double)
    tod_type: Mapped[Optional[str]] = mapped_column(String(20))

    plant: Mapped[Optional[Plant]] = relationship()


# =============================================================================================
# Savings page data (SYNCED)
# =============================================================================================
class IexTodDailyObligation(SyncedTimestamps, Base):
    """Locked daily savings statement. Official figures; plant_id may be NULL (admin-only rows)."""
    __tablename__ = "iex_tod_daily_obligation"
    __table_args__ = (
        UniqueConstraint("portfolio_id", "trade_date"),
        Index("itdo_plant_date_idx", "plant_id", "trade_date"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    plant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("plant.plant_id"))
    portfolio_id: Mapped[str] = mapped_column(String(64), nullable=False)
    trade_date: Mapped[dt.date] = mapped_column(Date, nullable=False)
    client_name: Mapped[Optional[str]] = mapped_column(String(200))
    plant_name: Mapped[Optional[str]] = mapped_column(String(200))
    # quantity and cost
    volume_cleared_kwh: Mapped[Optional[Decimal]] = mapped_column(N18)
    units_mwh: Mapped[Optional[Decimal]] = mapped_column(N18)
    iex_energy_charge: Mapped[Optional[Decimal]] = mapped_column(N18)
    iex_total_cost: Mapped[Optional[Decimal]] = mapped_column(N18)
    avg_landed_iex_tariff: Mapped[Optional[Decimal]] = mapped_column(N18)
    # itemized open access charges
    ctu_transmission_charges: Mapped[Optional[Decimal]] = mapped_column(N18)
    stu_transmission_charges: Mapped[Optional[Decimal]] = mapped_column(N18)
    distribution_charges: Mapped[Optional[Decimal]] = mapped_column(N18)
    nldc_application_fees: Mapped[Optional[Decimal]] = mapped_column(N18)
    nldc_scheduling_buy: Mapped[Optional[Decimal]] = mapped_column(N18)
    sldc_scheduling_charges: Mapped[Optional[Decimal]] = mapped_column(N18)
    fees: Mapped[Optional[Decimal]] = mapped_column(N18)
    igst: Mapped[Optional[Decimal]] = mapped_column(N18)
    css: Mapped[Optional[Decimal]] = mapped_column(N18)
    # grid benchmark
    grid_energy_cost: Mapped[Optional[Decimal]] = mapped_column(N18)
    electricity_duty_amount: Mapped[Optional[Decimal]] = mapped_column(N18)
    grid_total_cost: Mapped[Optional[Decimal]] = mapped_column(N18)
    avg_grid_tariff: Mapped[Optional[Decimal]] = mapped_column(N18)
    # savings
    net_savings_per_day: Mapped[Optional[Decimal]] = mapped_column(N18)
    percent_below_grid: Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 4))
    # generated files
    excel_file_path: Mapped[Optional[str]] = mapped_column(Text)
    statement_docx_path: Mapped[Optional[str]] = mapped_column(Text)
    pdf_report_path: Mapped[Optional[str]] = mapped_column(Text)
    zip_bundle_path: Mapped[Optional[str]] = mapped_column(Text)
    raw_summary: Mapped[Optional[Any]] = mapped_column(JSONB)
    is_locked: Mapped[Optional[bool]] = mapped_column(Boolean, server_default=text("true"))

    plant: Mapped[Optional[Plant]] = relationship()


class OptimizationResult(SyncedTimestamps, Base):
    __tablename__ = "optimization_results"
    __table_args__ = (
        UniqueConstraint("date", "block", "plant_id", "optimization_type"),
        block_check("block", "optimization_results_block_check"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    plant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("plant.plant_id"))
    date: Mapped[Optional[dt.date]] = mapped_column(Date)
    block: Mapped[Optional[int]] = mapped_column(Integer)
    optimization_type: Mapped[Optional[str]] = mapped_column(String(20))     # day_ahead / rtm
    demand_kwh: Mapped[Optional[float]] = mapped_column(Double)
    solar_kwh: Mapped[Optional[float]] = mapped_column(Double)
    iex_draw_kwh: Mapped[Optional[float]] = mapped_column(Double)
    grid_draw_kwh: Mapped[Optional[float]] = mapped_column(Double)
    iex_rs_per_kwh: Mapped[Optional[float]] = mapped_column(Double)
    grid_rs_per_kwh: Mapped[Optional[float]] = mapped_column(Double)
    solar_rs_per_kwh: Mapped[Optional[float]] = mapped_column(Double)
    landed_cost_iex_rs_per_kwh: Mapped[Optional[float]] = mapped_column(Double)
    final_cost: Mapped[Optional[float]] = mapped_column(Double)
    bank_balance_total: Mapped[Optional[float]] = mapped_column(Double)

    plant: Mapped[Optional[Plant]] = relationship()


# =============================================================================================
# App-owned extras
# =============================================================================================
class DashboardConfig(AppTimestamps, Base):
    """Per-client layout spec (web/lib/dashboard/schema.ts). client_id NULL = global default.
    At most one published row per client (and one global)."""
    __tablename__ = "dashboard_config"
    __table_args__ = (
        UniqueConstraint("client_id", "version", name="dashboard_config_client_version_key",
                         postgresql_nulls_not_distinct=True),
        CheckConstraint("status IN ('draft', 'published', 'archived')", name="dashboard_config_status_check"),
        Index("dashboard_config_one_published_idx", func.coalesce(text("client_id"), 0), unique=True,
              postgresql_where=text("status = 'published'")),
    )

    id: Mapped[int] = mapped_column(Integer, Identity(always=False), primary_key=True)
    client_id: Mapped[Optional[int]] = mapped_column(ForeignKey("client.client_id"))
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'draft'"))
    spec: Mapped[Any] = mapped_column(JSONB, nullable=False)
    note: Mapped[Optional[str]] = mapped_column(Text)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("user.id"))

    client: Mapped[Optional[Client]] = relationship(back_populates="dashboard_configs")


class SyncRun(Base):
    """One row per table per sync run, plus a table_name='__run__' row for the whole tier."""
    __tablename__ = "sync_runs"
    __table_args__ = (
        CheckConstraint("status IN ('running', 'ok', 'error', 'skipped')", name="sync_runs_status_check"),
        Index("sync_runs_table_started_idx", "table_name", text("started_at DESC")),
    )

    id: Mapped[int] = mapped_column(Integer, Identity(always=False), primary_key=True)
    tier: Mapped[str] = mapped_column(String(10), nullable=False)          # fast / slow
    table_name: Mapped[str] = mapped_column(String(100), nullable=False)
    window_from: Mapped[Optional[dt.date]] = mapped_column(Date)
    started_at: Mapped[dt.datetime] = mapped_column(TZ, nullable=False, server_default=func.now())
    finished_at: Mapped[Optional[dt.datetime]] = mapped_column(TZ)
    rows_written: Mapped[Optional[int]] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String(10), nullable=False)
    error: Mapped[Optional[str]] = mapped_column(Text)


__all__ = [
    "Base", "Client", "PlantType", "Plant", "Role", "Permission", "RolePermission", "User",
    "UserClientMap", "UserPlantMap", "Market", "MarketType", "PlantGenConMapping",
    "PlantOpenAccessCharges", "StateGridDiscomTariff", "StateGridSolarTariff",
    "PlantProcessedMeterData", "TradingResult", "TradingResultBlock", "PrebidPlan", "Banking",
    "IexTodDailyObligation", "OptimizationResult", "DashboardConfig", "SyncRun",
]
