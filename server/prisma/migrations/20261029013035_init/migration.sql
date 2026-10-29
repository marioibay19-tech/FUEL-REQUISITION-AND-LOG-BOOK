-- CreateEnum
CREATE TYPE "RoleCode" AS ENUM ('ADMIN', 'REQUESTER', 'APPROVER', 'CUSTODIAN');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'UNDER_REPAIR', 'RETIRED');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'RETURNED', 'READY_FOR_ISSUANCE', 'PARTIALLY_ISSUED', 'FULLY_ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ReadingType" AS ENUM ('ACTUAL', 'ESTIMATED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "OdometerSource" AS ENUM ('FUEL_TRANSACTION', 'MANUAL_READING', 'INITIAL_REGISTRATION');

-- CreateEnum
CREATE TYPE "ReferenceSource" AS ENUM ('COMPUTED_INTERVAL', 'MANUAL');

-- CreateTable
CREATE TABLE "offices_or_divisions" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "default_approver_id" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "offices_or_divisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" SERIAL NOT NULL,
    "code" "RoleCode" NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "description" VARCHAR(255),

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" VARCHAR(50) NOT NULL,
    "password_hash" VARCHAR(100) NOT NULL,
    "full_name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(150),
    "position" VARCHAR(120),
    "office_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" INTEGER NOT NULL,
    "role_id" INTEGER NOT NULL,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "fuel_types" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "default_price_per_liter" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fuel_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" SERIAL NOT NULL,
    "plate_number" VARCHAR(20) NOT NULL,
    "property_number" VARCHAR(40),
    "description" VARCHAR(200) NOT NULL,
    "make" VARCHAR(60),
    "model" VARCHAR(60),
    "year" INTEGER,
    "classification" VARCHAR(60) NOT NULL,
    "fuel_type_id" INTEGER NOT NULL,
    "office_id" INTEGER,
    "custodian_name" VARCHAR(120),
    "custodian_user_id" INTEGER,
    "tank_capacity_liters" DECIMAL(8,2),
    "current_odometer" DECIMAL(12,1) NOT NULL DEFAULT 0,
    "current_odometer_at" TIMESTAMPTZ(6),
    "registration_expiry" DATE,
    "last_maintenance_date" DATE,
    "next_maintenance_date" DATE,
    "maintenance_notes" TEXT,
    "status" "VehicleStatus" NOT NULL DEFAULT 'ACTIVE',
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_requests" (
    "id" SERIAL NOT NULL,
    "request_number" VARCHAR(30) NOT NULL,
    "client_token" VARCHAR(64),
    "request_date" DATE NOT NULL,
    "requester_id" INTEGER NOT NULL,
    "office_id" INTEGER,
    "purpose" VARCHAR(500) NOT NULL,
    "destination" VARCHAR(300),
    "travel_date" DATE,
    "remarks" TEXT,
    "vehicle_id" INTEGER NOT NULL,
    "odometer_at_request" DECIMAL(12,1),
    "fuel_type_id" INTEGER NOT NULL,
    "fuel_type_override" BOOLEAN NOT NULL DEFAULT false,
    "override_reason" VARCHAR(300),
    "requested_liters" DECIMAL(10,2) NOT NULL,
    "approved_liters" DECIMAL(10,2),
    "issued_liters" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "estimated_price_per_liter" DECIMAL(10,2) NOT NULL,
    "estimated_total_cost" DECIMAL(14,2) NOT NULL,
    "intended_fueling_date" DATE,
    "reason" VARCHAR(500),
    "status" "RequestStatus" NOT NULL DEFAULT 'DRAFT',
    "assigned_approver_id" INTEGER,
    "flagged_for_review" BOOLEAN NOT NULL DEFAULT false,
    "flag_reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "submitted_at" TIMESTAMPTZ(6),
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fuel_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_request_items" (
    "id" SERIAL NOT NULL,
    "request_id" INTEGER NOT NULL,
    "fuel_type_id" INTEGER NOT NULL,
    "liters" DECIMAL(10,2) NOT NULL,
    "price_per_liter" DECIMAL(10,2) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "fuel_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_approvals" (
    "id" SERIAL NOT NULL,
    "request_id" INTEGER NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "previous_status" "RequestStatus",
    "new_status" "RequestStatus" NOT NULL,
    "acted_by_id" INTEGER NOT NULL,
    "remarks" TEXT,
    "reason" TEXT,
    "approved_liters" DECIMAL(10,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fuel_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_transactions" (
    "id" SERIAL NOT NULL,
    "transaction_number" VARCHAR(30) NOT NULL,
    "client_token" VARCHAR(64),
    "request_id" INTEGER,
    "transaction_date" TIMESTAMPTZ(6) NOT NULL,
    "vehicle_id" INTEGER NOT NULL,
    "fuel_type_id" INTEGER NOT NULL,
    "requested_liters" DECIMAL(10,2),
    "approved_liters" DECIMAL(10,2),
    "liters_issued" DECIMAL(10,2) NOT NULL,
    "price_per_liter" DECIMAL(10,2) NOT NULL,
    "total_cost" DECIMAL(14,2) NOT NULL,
    "odometer_reading" DECIMAL(12,1),
    "is_full_tank" BOOLEAN NOT NULL DEFAULT false,
    "station" VARCHAR(150),
    "receipt_number" VARCHAR(60),
    "remarks" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'ACTIVE',
    "corrects_id" INTEGER,
    "status_reason" TEXT,
    "encoded_by_id" INTEGER NOT NULL,
    "verified_by_id" INTEGER,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fuel_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "odometer_logs" (
    "id" SERIAL NOT NULL,
    "record_number" VARCHAR(30) NOT NULL,
    "vehicle_id" INTEGER NOT NULL,
    "transaction_id" INTEGER,
    "source" "OdometerSource" NOT NULL,
    "reading_date" TIMESTAMPTZ(6) NOT NULL,
    "is_full_tank" BOOLEAN NOT NULL DEFAULT false,
    "fuel_liters" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "previous_verified_odometer" DECIMAL(12,1),
    "previous_verified_at" TIMESTAMPTZ(6),
    "previous_verified_log_id" INTEGER,
    "actual_odometer" DECIMAL(12,1),
    "original_actual_odometer" DECIMAL(12,1),
    "actual_recorded_at" TIMESTAMPTZ(6),
    "distance_traveled" DECIMAL(12,1),
    "estimate_status" VARCHAR(30) NOT NULL DEFAULT 'NOT_COMPUTED',
    "estimate_method" VARCHAR(40),
    "consumption_basis" VARCHAR(40),
    "estimate_liters" DECIMAL(10,2),
    "efficiency_km_per_liter" DECIMAL(10,4),
    "efficiency_quality" VARCHAR(20),
    "reference_start" TIMESTAMPTZ(6),
    "reference_end" TIMESTAMPTZ(6),
    "reference_liters" DECIMAL(10,2),
    "reference_distance" DECIMAL(12,1),
    "reference_id" INTEGER,
    "reference_intervals" INTEGER,
    "estimated_distance" DECIMAL(12,1),
    "estimated_odometer" DECIMAL(12,1),
    "estimate_computed_at" TIMESTAMPTZ(6),
    "variance_km" DECIMAL(12,1),
    "variance_pct" DECIMAL(8,2),
    "reading_type" "ReadingType" NOT NULL,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "encoded_by_id" INTEGER NOT NULL,
    "verified_by_id" INTEGER,
    "verified_at" TIMESTAMPTZ(6),
    "is_voided" BOOLEAN NOT NULL DEFAULT false,
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "odometer_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_efficiency_references" (
    "id" SERIAL NOT NULL,
    "vehicle_id" INTEGER NOT NULL,
    "source" "ReferenceSource" NOT NULL,
    "period_start" TIMESTAMPTZ(6),
    "period_end" TIMESTAMPTZ(6),
    "reference_liters" DECIMAL(10,2) NOT NULL,
    "reference_distance" DECIMAL(12,1) NOT NULL,
    "efficiency_km_per_liter" DECIMAL(10,4) NOT NULL,
    "quality" VARCHAR(20) NOT NULL,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "approved_by_id" INTEGER NOT NULL,
    "approved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fuel_efficiency_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" SERIAL NOT NULL,
    "entity_type" VARCHAR(30) NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "stored_name" VARCHAR(100) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "description" VARCHAR(255),
    "uploaded_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "message" TEXT NOT NULL,
    "link" VARCHAR(255),
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER,
    "action" VARCHAR(60) NOT NULL,
    "module" VARCHAR(40) NOT NULL,
    "record_id" VARCHAR(60),
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip_address" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" VARCHAR(80) NOT NULL,
    "value" JSONB NOT NULL,
    "description" VARCHAR(300),
    "updated_by_id" INTEGER,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "name" VARCHAR(40) NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "session" (
    "sid" VARCHAR NOT NULL,
    "sess" JSONB NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);

-- CreateIndex
CREATE UNIQUE INDEX "offices_or_divisions_code_key" ON "offices_or_divisions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_types_code_key" ON "fuel_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_types_name_key" ON "fuel_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plate_number_key" ON "vehicles"("plate_number");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_property_number_key" ON "vehicles"("property_number");

-- CreateIndex
CREATE INDEX "vehicles_status_idx" ON "vehicles"("status");

-- CreateIndex
CREATE INDEX "vehicles_office_id_idx" ON "vehicles"("office_id");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_requests_request_number_key" ON "fuel_requests"("request_number");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_requests_client_token_key" ON "fuel_requests"("client_token");

-- CreateIndex
CREATE INDEX "fuel_requests_status_idx" ON "fuel_requests"("status");

-- CreateIndex
CREATE INDEX "fuel_requests_requester_id_idx" ON "fuel_requests"("requester_id");

-- CreateIndex
CREATE INDEX "fuel_requests_vehicle_id_created_at_idx" ON "fuel_requests"("vehicle_id", "created_at");

-- CreateIndex
CREATE INDEX "fuel_requests_assigned_approver_id_status_idx" ON "fuel_requests"("assigned_approver_id", "status");

-- CreateIndex
CREATE INDEX "fuel_requests_request_date_idx" ON "fuel_requests"("request_date");

-- CreateIndex
CREATE INDEX "fuel_request_items_request_id_idx" ON "fuel_request_items"("request_id");

-- CreateIndex
CREATE INDEX "fuel_approvals_request_id_created_at_idx" ON "fuel_approvals"("request_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_transactions_transaction_number_key" ON "fuel_transactions"("transaction_number");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_transactions_client_token_key" ON "fuel_transactions"("client_token");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_transactions_corrects_id_key" ON "fuel_transactions"("corrects_id");

-- CreateIndex
CREATE INDEX "fuel_transactions_vehicle_id_transaction_date_idx" ON "fuel_transactions"("vehicle_id", "transaction_date");

-- CreateIndex
CREATE INDEX "fuel_transactions_transaction_date_idx" ON "fuel_transactions"("transaction_date");

-- CreateIndex
CREATE INDEX "fuel_transactions_status_idx" ON "fuel_transactions"("status");

-- CreateIndex
CREATE INDEX "fuel_transactions_request_id_idx" ON "fuel_transactions"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "odometer_logs_record_number_key" ON "odometer_logs"("record_number");

-- CreateIndex
CREATE UNIQUE INDEX "odometer_logs_transaction_id_key" ON "odometer_logs"("transaction_id");

-- CreateIndex
CREATE INDEX "odometer_logs_vehicle_id_reading_date_idx" ON "odometer_logs"("vehicle_id", "reading_date");

-- CreateIndex
CREATE INDEX "odometer_logs_verification_status_idx" ON "odometer_logs"("verification_status");

-- CreateIndex
CREATE INDEX "odometer_logs_reading_type_idx" ON "odometer_logs"("reading_type");

-- CreateIndex
CREATE INDEX "fuel_efficiency_references_vehicle_id_is_active_idx" ON "fuel_efficiency_references"("vehicle_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_stored_name_key" ON "attachments"("stored_name");

-- CreateIndex
CREATE INDEX "attachments_entity_type_entity_id_idx" ON "attachments"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_module_record_id_idx" ON "audit_logs"("module", "record_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "IDX_session_expire" ON "session"("expire");

-- AddForeignKey
ALTER TABLE "offices_or_divisions" ADD CONSTRAINT "offices_or_divisions_default_approver_id_fkey" FOREIGN KEY ("default_approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "offices_or_divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_fuel_type_id_fkey" FOREIGN KEY ("fuel_type_id") REFERENCES "fuel_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "offices_or_divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_custodian_user_id_fkey" FOREIGN KEY ("custodian_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_requests" ADD CONSTRAINT "fuel_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_requests" ADD CONSTRAINT "fuel_requests_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "offices_or_divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_requests" ADD CONSTRAINT "fuel_requests_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_requests" ADD CONSTRAINT "fuel_requests_fuel_type_id_fkey" FOREIGN KEY ("fuel_type_id") REFERENCES "fuel_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_requests" ADD CONSTRAINT "fuel_requests_assigned_approver_id_fkey" FOREIGN KEY ("assigned_approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_request_items" ADD CONSTRAINT "fuel_request_items_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "fuel_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_approvals" ADD CONSTRAINT "fuel_approvals_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "fuel_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_approvals" ADD CONSTRAINT "fuel_approvals_acted_by_id_fkey" FOREIGN KEY ("acted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "fuel_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_fuel_type_id_fkey" FOREIGN KEY ("fuel_type_id") REFERENCES "fuel_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_corrects_id_fkey" FOREIGN KEY ("corrects_id") REFERENCES "fuel_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_encoded_by_id_fkey" FOREIGN KEY ("encoded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "odometer_logs" ADD CONSTRAINT "odometer_logs_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "odometer_logs" ADD CONSTRAINT "odometer_logs_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "fuel_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "odometer_logs" ADD CONSTRAINT "odometer_logs_encoded_by_id_fkey" FOREIGN KEY ("encoded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "odometer_logs" ADD CONSTRAINT "odometer_logs_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_efficiency_references" ADD CONSTRAINT "fuel_efficiency_references_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_efficiency_references" ADD CONSTRAINT "fuel_efficiency_references_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Integrity rules enforced by the database itself (in addition to the API).
-- ---------------------------------------------------------------------------
ALTER TABLE "fuel_requests"
  ADD CONSTRAINT "fuel_requests_requested_liters_positive" CHECK ("requested_liters" > 0),
  ADD CONSTRAINT "fuel_requests_approved_liters_positive" CHECK ("approved_liters" IS NULL OR "approved_liters" > 0),
  ADD CONSTRAINT "fuel_requests_issued_liters_nonneg" CHECK ("issued_liters" >= 0),
  ADD CONSTRAINT "fuel_requests_price_nonneg" CHECK ("estimated_price_per_liter" >= 0);

ALTER TABLE "fuel_transactions"
  ADD CONSTRAINT "fuel_transactions_liters_positive" CHECK ("liters_issued" > 0),
  ADD CONSTRAINT "fuel_transactions_price_nonneg" CHECK ("price_per_liter" >= 0),
  ADD CONSTRAINT "fuel_transactions_odometer_nonneg" CHECK ("odometer_reading" IS NULL OR "odometer_reading" >= 0);

ALTER TABLE "odometer_logs"
  ADD CONSTRAINT "odometer_logs_actual_nonneg" CHECK ("actual_odometer" IS NULL OR "actual_odometer" >= 0),
  ADD CONSTRAINT "odometer_logs_reading_type_consistent" CHECK (
    ("reading_type" = 'ACTUAL' AND "actual_odometer" IS NOT NULL) OR
    ("reading_type" = 'ESTIMATED' AND "actual_odometer" IS NULL)
  );

ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_odometer_nonneg" CHECK ("current_odometer" >= 0);

-- Audit trail and approval history are append-only.
CREATE OR REPLACE FUNCTION fueltrack_block_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Records in % cannot be %d', TG_TABLE_NAME, lower(TG_OP);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION fueltrack_block_modification();

CREATE TRIGGER fuel_approvals_append_only
  BEFORE UPDATE OR DELETE ON "fuel_approvals"
  FOR EACH ROW EXECUTE FUNCTION fueltrack_block_modification();

-- Historical fuel transactions and odometer logs are never deleted; they are
-- superseded, voided or corrected instead.
CREATE TRIGGER fuel_transactions_no_delete
  BEFORE DELETE ON "fuel_transactions"
  FOR EACH ROW EXECUTE FUNCTION fueltrack_block_modification();

CREATE TRIGGER odometer_logs_no_delete
  BEFORE DELETE ON "odometer_logs"
  FOR EACH ROW EXECUTE FUNCTION fueltrack_block_modification();
