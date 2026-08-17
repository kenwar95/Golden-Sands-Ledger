-- Shared operations v2 helper indexes.
CREATE INDEX IF NOT EXISTS idx_transfer_lines_transfer ON transfer_lines(transfer_id);
CREATE INDEX IF NOT EXISTS idx_transfer_movements_line ON transfer_batch_movements(transfer_line_id);
CREATE INDEX IF NOT EXISTS idx_sale_lines_sale ON sale_lines(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_line_batches_line ON sale_line_batches(sale_line_id);
