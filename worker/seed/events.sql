INSERT INTO events (slug, title, default_capacity, default_price_paise, active) VALUES
  ('murder-mystery',    'Murder Mystery',    20, 0, 1),
  ('night-of-mafias',   'Night of Mafias',   25, 0, 1),
  ('board-game-night',  'Board Game Night',  25, 0, 1),
  ('party-games-night', 'Party Games Night', 25, 0, 1),
  ('trivia-takedown',   'Trivia Takedown',   25, 0, 1),
  ('game-set-switch',   'Game Set Switch',   25, 0, 1)
ON CONFLICT(slug) DO UPDATE SET
  title = excluded.title,
  active = excluded.active;
