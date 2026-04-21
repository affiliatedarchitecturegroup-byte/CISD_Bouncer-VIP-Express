import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Venues table
  await knex.schema.createTable('venues', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('name', 255).notNullable();
    table.string('address').notNullable();
    table.string('contact_person').notNullable();
    table.string('contact_email').notNullable();
    table.string('contact_phone', 20).notNullable();
    table.enum('venue_type', ['bar', 'club', 'restaurant', 'hotel', 'event_venue', 'other']).notNullable();
    table.string('psira_license', 50);
    table.enum('status', ['active', 'inactive', 'pending']).notNullable().defaultTo('pending');
    table.enum('subscription_tier', ['basic', 'standard', 'premium']).notNullable().defaultTo('basic');
    table.decimal('latitude', 10, 8);
    table.decimal('longitude', 11, 8);
    table.text('notes');
    table.timestamps(true, true);
  });

  // Clients table
  await knex.schema.createTable('clients', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('venue_id').notNullable().references('id').inTable('venues').onDelete('CASCADE');
    table.string('first_name', 100).notNullable();
    table.string('last_name', 100).notNullable();
    table.string('email').notNullable();
    table.string('phone', 20).notNullable();
    table.enum('role', ['owner', 'manager', 'contact']).notNullable().defaultTo('contact');
    table.boolean('is_primary').notNullable().defaultTo(false);
    table.timestamps(true, true);
  });

  // Security officers table
  await knex.schema.createTable('security_officers', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('first_name', 100).notNullable();
    table.string('last_name', 100).notNullable();
    table.string('email').notNullable().unique();
    table.string('phone', 20).notNullable();
    table.string('psira_registration', 50).notNullable().unique();
    table.date('psira_expiry').notNullable();
    table.date('date_of_birth').notNullable();
    table.string('id_number', 13).notNullable().unique();
    table.string('address').notNullable();
    table.string('emergency_contact_name', 100);
    table.string('emergency_contact_phone', 20);
    table.enum('status', ['active', 'inactive', 'suspended', 'pending_approval']).notNullable().defaultTo('pending_approval');
    table.string('profile_photo_url');
    table.text('notes');
    table.timestamps(true, true);
  });

  // Shifts table
  await knex.schema.createTable('shifts', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('venue_id').notNullable().references('id').inTable('venues').onDelete('CASCADE');
    table.uuid('officer_id').notNullable().references('id').inTable('security_officers').onDelete('CASCADE');
    table.timestamp('start_time').notNullable();
    table.timestamp('end_time').notNullable();
    table.decimal('hourly_rate', 10, 2);
    table.enum('status', ['scheduled', 'clocked_in', 'clocked_out', 'cancelled', 'no_show']).notNullable().defaultTo('scheduled');
    table.timestamp('clock_in_time');
    table.timestamp('clock_out_time');
    table.string('clock_in_location');
    table.string('clock_out_location');
    table.text('incident_notes');
    table.timestamps(true, true);
  });

  // Deployments table (for tracking actual security assignments)
  await knex.schema.createTable('deployments', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('venue_id').notNullable().references('id').inTable('venues').onDelete('CASCADE');
    table.date('date').notNullable();
    table.integer('officer_count').notNullable().defaultTo(1);
    table.decimal('total_cost', 10, 2);
    table.enum('status', ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled']).notNullable().defaultTo('pending');
    table.text('notes');
    table.timestamps(true, true);
  });

  // Create indexes
  await knex.schema.raw('CREATE INDEX idx_venues_status ON venues(status)');
  await knex.schema.raw('CREATE INDEX idx_clients_venue_id ON clients(venue_id)');
  await knex.schema.raw('CREATE INDEX idx_shifts_venue_id ON shifts(venue_id)');
  await knex.schema.raw('CREATE INDEX idx_shifts_officer_id ON shifts(officer_id)');
  await knex.schema.raw('CREATE INDEX idx_shifts_start_time ON shifts(start_time)');
  await knex.schema.raw('CREATE INDEX idx_deployments_venue_id ON deployments(venue_id)');
  await knex.schema.raw('CREATE INDEX idx_deployments_date ON deployments(date)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('deployments');
  await knex.schema.dropTableIfExists('shifts');
  await knex.schema.dropTableIfExists('security_officers');
  await knex.schema.dropTableIfExists('clients');
  await knex.schema.dropTableIfExists('venues');
}