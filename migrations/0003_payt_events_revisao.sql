-- Fila do admin (CLAUDE.md §13): eventos com erro OU marcados para revisão.
-- Reembolso parcial e chargeback apresentado não revogam sozinhos (§7), então
-- precisam de um lugar para esperar decisão humana.

ALTER TABLE payt_events ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_payt_events_revisao
    ON payt_events (needs_review, received_at)
 WHERE needs_review = 1;
