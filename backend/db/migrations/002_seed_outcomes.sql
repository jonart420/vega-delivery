-- Default delivery outcomes and reasons. Editable/extendable under Settings → Outcomes & reasons.
insert into delivery_outcomes
  (code, label_en, label_de, kind, icon, color, requires_reason, requires_photo, requires_signature, requires_recipient, requires_scan, final, sort, system)
values
  ('delivered',  'Delivered',            'Zugestellt',              'success', 'check',    '#16a34a', false, false, true,  true,  false, true,  10, true),
  ('neighbor',   'Left with neighbour',  'Beim Nachbarn abgegeben', 'success', 'users',    '#22c55e', false, false, true,  true,  false, true,  20, false),
  ('safe_place', 'Left at safe place',   'Am Abstellort abgelegt',  'success', 'box',      '#4ade80', false, true,  false, false, false, true,  30, false),
  ('partial',    'Partially delivered',  'Teilweise zugestellt',    'success', 'half',     '#84cc16', true,  false, true,  true,  false, true,  40, false),
  ('not_home',   'Nobody home',          'Nicht angetroffen',       'failure', 'door',     '#f59e0b', false, true,  false, false, false, true,  50, false),
  ('refused',    'Refused',              'Annahme verweigert',      'failure', 'hand',     '#ef4444', true,  false, false, true,  false, true,  60, true),
  ('aborted',    'Aborted',              'Abgebrochen',             'failure', 'x',        '#dc2626', true,  false, false, false, false, true,  70, true)
on conflict (code) do nothing;

insert into delivery_reasons (outcome_code, label_en, label_de, sort)
select * from (values
  ('refused',  'Goods damaged',              'Ware beschädigt',              10),
  ('refused',  'Wrong goods',                'Falsche Ware',                 20),
  ('refused',  'Not ordered',                'Nicht bestellt',               30),
  ('refused',  'Delivery too late',          'Lieferung zu spät',            40),
  ('refused',  'Cash on delivery refused',   'Nachnahme nicht bezahlt',      50),
  ('aborted',  'Address not found',          'Adresse nicht gefunden',       10),
  ('aborted',  'No access to building',      'Kein Zugang zum Gebäude',      20),
  ('aborted',  'Vehicle breakdown',          'Fahrzeugdefekt',               30),
  ('aborted',  'Out of time',                'Zeit reicht nicht',            40),
  ('aborted',  'Goods missing in vehicle',   'Ware fehlt im Fahrzeug',       50),
  ('partial',  'Item out of stock',          'Artikel nicht vorrätig',       10),
  ('partial',  'Item damaged',               'Artikel beschädigt',           20)
) as v(outcome_code, label_en, label_de, sort)
where not exists (select 1 from delivery_reasons);

insert into settings (key, value) values
  ('company', '{"name": "", "phone": "", "email": "", "website": ""}'),
  ('depot', '{"label": "", "lat": null, "lon": null}'),
  ('tour_defaults', '{"dwell_minutes": 4, "planned_start": "08:00", "mode": "auto"}'),
  ('notifications', '{"lead_stops": 3, "day_start": true, "approaching": true, "delivered": false, "failed": false, "eta_window_minutes": 60}'),
  ('barcodes', '{"mode": "per_delivery", "ean13_prefix": "21"}')
on conflict (key) do nothing;
