#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'
require 'yaml'
require 'time'
require 'date'
require 'uri'
require 'net/http'

SITE_TIMEZONE = ENV.fetch('SITE_TIMEZONE', 'Asia/Kolkata')
DEFAULT_ICS_URL = 'https://calendar.google.com/calendar/ical/da645a8c3679d92a4f5aa27a0415af79342a316216a0f83f9d299327c1f0b56e%40group.calendar.google.com/public/basic.ics'
MAX_OCCURRENCES = 200

# Utility helpers -----------------------------------------------------------

def log(msg)
  warn("[sync-events] #{msg}")
end

def read_front_matter(path)
  raw = File.read(path)
  match = raw.match(/\A---\s*\n(.*?)\n---\s*\n/m)
  return {} unless match

  YAML.safe_load(match[1], permitted_classes: [Date, Time], aliases: true) || {}
rescue Psych::SyntaxError => e
  raise "Invalid front matter in #{path}: #{e.message}"
end

def slugify(value)
  value.to_s.downcase.gsub(/[^a-z0-9]+/, '-').gsub(/^-+|-+$/, '')
end

def load_locations(path)
  return {} unless File.file?(path)

  data = YAML.safe_load(File.read(path)) || {}
  idx = {}
  data.each_value do |entry|
    next unless entry.is_a?(Hash) && entry['name']
    key = entry['name'].to_s.downcase.strip
    idx[key] = {
      'name' => entry['name'].to_s,
      'map_url' => entry['map_url'].to_s
    }
  end
  idx
end

def load_events(base_dir)
  dirs = [File.join(base_dir, '_events', '*'), File.join(base_dir, 'events', '*')]
  events = []
  dirs.each do |pattern|
    Dir.glob(pattern).each do |file|
      next unless File.file?(file)
      fm = read_front_matter(file)
      next unless fm.is_a?(Hash)
      title = fm['title']&.to_s&.strip
      next if title.nil? || title.empty?

      slug = (fm['slug'] || File.basename(file).sub(/\.[^.]+\z/, '')).to_s
      permalink = fm['permalink']&.to_s&.strip
      page_url = if permalink && !permalink.empty?
                   permalink
                 else
                   "/events/#{slugify(slug)}/"
                 end

      events << {
        path: file,
        title: title,
        normalized_title: title.downcase.strip,
        slug: slugify(slug),
        banner: (fm['banner'] || fm['hero_image']).to_s,
        intro: (fm['intro'] || fm['tagline'] || '').to_s,
        ticket_link: fm['ticket_link']&.to_s,
        page_url: page_url,
      }
    end
  end
  events
end

def fetch_ics(source_path = nil)
  if source_path && !source_path.empty?
    log "Reading ICS from #{source_path}"
    return File.read(source_path)
  end

  url = ENV['GOOGLE_CALENDAR_ICS_URL']&.strip
  url = DEFAULT_ICS_URL if url.nil? || url.empty?
  log "Fetching ICS feed from #{url}"

  uri = URI.parse(url)
  Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == 'https') do |http|
    request = Net::HTTP::Get.new(uri)
    request['User-Agent'] = 'GamesLabScheduleSync/1.0'
    response = http.request(request)
    unless response.is_a?(Net::HTTPSuccess)
      raise "ICS fetch failed with #{response.code} #{response.message}"
    end
    response.body
  end
end

def unfold_ics(text)
  text.gsub(/\r?\n[ \t]/, '')
end

def parse_ics(text)
  events = []
  current = nil
  unfold_ics(text).each_line do |line|
    line = line.delete("\r\n")
    next if line.empty?

    case line
    when 'BEGIN:VEVENT'
      current = {}
    when 'END:VEVENT'
      events << current if current
      current = nil
    else
      next unless current
      key_part, value = line.split(':', 2)
      next if value.nil?
      name, param_str = key_part.split(';', 2)
      params = {}
      if param_str
        param_str.split(';').each do |pair|
          k, v = pair.split('=', 2)
          params[k.upcase] = v if k && v
        end
      end
      name = name.upcase
      entry = { value: value, params: params }
      if current.key?(name)
        current[name] = Array(current[name]) << entry
      else
        current[name] = entry
      end
    end
  end
  events
end

def single_value(event, key)
  value = event[key]
  return nil unless value
  value.is_a?(Array) ? value.first : value
end

def value_list(event, key)
  value = event[key]
  return [] unless value
  Array(value)
end

def parse_ics_time(entry, fallback_tz)
  return nil unless entry
  value = entry[:value]
  params = entry[:params] || {}
  tz = params['TZID'] || fallback_tz || SITE_TIMEZONE
  if params['VALUE'] == 'DATE' || value.match?(/^\d{8}\z/)
    year = value[0, 4].to_i
    month = value[4, 2].to_i
    day = value[6, 2].to_i
    prev = ENV['TZ']
    begin
      ENV['TZ'] = tz
      Time.local(year, month, day)
    ensure
      ENV['TZ'] = prev
    end
  elsif value.end_with?('Z')
    Time.parse(value)
  elsif value.match(/^\d{8}T\d{6}\z/)
    year = value[0, 4].to_i
    month = value[4, 2].to_i
    day = value[6, 2].to_i
    hour = value[9, 2].to_i
    min = value[11, 2].to_i
    sec = value[13, 2].to_i
    prev = ENV['TZ']
    begin
      ENV['TZ'] = tz
      Time.local(year, month, day, hour, min, sec)
    ensure
      ENV['TZ'] = prev
    end
  else
    Time.parse(value)
  end
end

def parse_rrule(entry)
  return {} unless entry
  rule = entry[:value].to_s.strip
  rule.split(';').each_with_object({}) do |part, memo|
    k, v = part.split('=', 2)
    memo[k.upcase] = v if k && v
  end
end

def parse_exdates(entries, fallback_tz)
  value_list(entries, 'EXDATE').flat_map do |entry|
    entry[:value].split(',').map do |val|
      parse_ics_time({ value: val, params: entry[:params] || {} }, fallback_tz)
    end
  end.compact
end

def parse_rdates(entries, fallback_tz)
  value_list(entries, 'RDATE').flat_map do |entry|
    entry[:value].split(',').map do |val|
      parse_ics_time({ value: val, params: entry[:params] || {} }, fallback_tz)
    end
  end.compact
end

def add_months(time, interval)
  dt = time.to_datetime >> interval
  Time.new(dt.year, dt.month, dt.day, time.hour, time.min, time.sec, time.utc_offset)
end

def next_occurrence_time(time, freq, interval)
  case freq
  when 'DAILY'
    time + interval * 86_400
  when 'WEEKLY'
    time + interval * 7 * 86_400
  when 'MONTHLY'
    add_months(time, interval)
  when 'YEARLY'
    add_months(time, interval * 12)
  else
    nil
  end
end

def generate_occurrence_starts(base_time, rrule)
  return [base_time] if rrule.empty?

  freq = rrule['FREQ']
  return [base_time] unless freq

  interval = (rrule['INTERVAL'] || '1').to_i
  interval = 1 if interval <= 0
  count = rrule['COUNT']&.to_i
  until_time = nil
  if rrule['UNTIL']
    until_time = parse_ics_time({ value: rrule['UNTIL'], params: {} }, SITE_TIMEZONE)
  end

  starts = [base_time]
  while starts.length < MAX_OCCURRENCES
    break if count && starts.length >= count
    next_time = next_occurrence_time(starts.last, freq, interval)
    break unless next_time
    break if until_time && next_time > until_time
    starts << next_time
  end
  starts
end

def apply_overrides(starts, overrides)
  return starts.map { |t| [t, nil] } unless overrides

  starts.map do |start_time|
    key = start_time.iso8601
    [start_time, overrides[key]]
  end
end

def occurrence_duration(start_time, end_time)
  return 3 * 3600 unless end_time
  [end_time - start_time, 0].max
end

def enrich_occurrence(base, override, exdates)
  start_time = override&.dig(:start_time) || base[:start_time]
  return nil if exdates.any? { |ex| (ex - start_time).abs < 1 }

  status = override&.dig(:status) || base[:status]
  return nil if status&.upcase == 'CANCELLED'

  {
    start_time: start_time,
    end_time: override&.dig(:end_time) || base[:end_time],
    status: status || 'CONFIRMED',
    all_day: override.nil? ? base[:all_day] : override[:all_day],
    location: override&.dig(:location) || base[:location],
    raw_location: override&.dig(:raw_location) || base[:raw_location],
    description: override&.dig(:description) || base[:description],
    uid: override&.dig(:uid) || base[:uid],
  }
end

def build_override_map(events, timezone)
  grouped = Hash.new { |h, k| h[k] = {} }
  events.each do |evt|
    uid = single_value(evt, 'UID')&.dig(:value)
    rid = single_value(evt, 'RECURRENCE-ID')
    next unless uid && rid
    start_time = parse_ics_time(rid, timezone)
    next unless start_time

    status = single_value(evt, 'STATUS')&.dig(:value)
    start_entry = single_value(evt, 'DTSTART')
    end_entry = single_value(evt, 'DTEND')
    override = {
      start_time: parse_ics_time(start_entry, timezone) || start_time,
      end_time: parse_ics_time(end_entry, timezone),
      status: status,
      all_day: (start_entry&.dig(:params)&.fetch('VALUE', nil) == 'DATE'),
      location: single_value(evt, 'LOCATION')&.dig(:value),
      raw_location: single_value(evt, 'LOCATION')&.dig(:value),
      description: single_value(evt, 'DESCRIPTION')&.dig(:value),
      uid: uid,
    }
    grouped[uid][start_time.iso8601] = override
  end
  grouped
end

def expand_events(events)
  timezone = SITE_TIMEZONE
  overrides = build_override_map(events.select { |evt| evt.key?('RECURRENCE-ID') }, timezone)
  masters = events.reject { |evt| evt.key?('RECURRENCE-ID') }

  masters.flat_map do |evt|
    uid = single_value(evt, 'UID')&.dig(:value)
    summary = single_value(evt, 'SUMMARY')&.dig(:value)
    next [] unless summary

    status = single_value(evt, 'STATUS')&.dig(:value)
    next [] if status&.upcase == 'CANCELLED'

    start_entry = single_value(evt, 'DTSTART')
    end_entry = single_value(evt, 'DTEND')
    start_time = parse_ics_time(start_entry, timezone)
    end_time = parse_ics_time(end_entry, timezone)
    next [] unless start_time

    all_day = start_entry&.dig(:params)&.fetch('VALUE', nil) == 'DATE'
    rrule = parse_rrule(single_value(evt, 'RRULE'))
    exdates = parse_exdates(evt, timezone)
    rdates = parse_rdates(evt, timezone)
    location = single_value(evt, 'LOCATION')&.dig(:value)
    description = single_value(evt, 'DESCRIPTION')&.dig(:value)

    base_occurrence = {
      start_time: start_time,
      end_time: end_time,
      status: status,
      all_day: all_day,
      location: location,
      raw_location: location,
      description: description,
      uid: uid,
    }

    starts = generate_occurrence_starts(start_time, rrule)
    starts += rdates
    starts.uniq!
    starts.sort!

    applied = apply_overrides(starts, overrides[uid])
    applied.map do |start_at, override|
      enrich_occurrence(base_occurrence, override, exdates)
    end.compact.map do |occ|
      occ.merge(summary: summary)
    end
  end.compact
end

def format_date(time)
  time.strftime('%d %b %Y')
end

def format_time_range(start_time, end_time, all_day)
  return 'All day' if all_day
  start_str = start_time.strftime('%I:%M %p').sub(/^0/, '')
  return start_str unless end_time && end_time > start_time
  end_str = end_time.strftime('%I:%M %p').sub(/^0/, '')
  "#{start_str} – #{end_str}"
end

def build_schedule(base_dir)
  locations = load_locations(File.join(base_dir, '_data', 'locations.yml'))
  events_meta = load_events(base_dir)
  meta_by_title = events_meta.each_with_object({}) do |meta, memo|
    memo[meta[:normalized_title]] = meta
  end
  meta_by_slug = events_meta.each_with_object({}) do |meta, memo|
    memo[meta[:slug]] = meta
  end

  ics_source = nil
  if ARGV.include?('--ics')
    idx = ARGV.index('--ics')
    ics_source = ARGV[idx + 1]
  elsif (env_source = ENV['GOOGLE_CALENDAR_ICS_FILE'])
    ics_source = env_source
  end

  raw_ics = fetch_ics(ics_source)
  occurrences = expand_events(parse_ics(raw_ics))
  now = Time.now

  grouped = Hash.new { |h, k| h[k] = [] }
  occurrences.each do |occ|
    title = occ[:summary].to_s.strip
    meta = meta_by_title[title.downcase]
    unless meta
      log "Skipping calendar event without matching content: #{title.inspect}"
      next
    end

    location_name = occ[:location]&.strip
    location_entry = locations[location_name.to_s.downcase]
    location_payload = {
      'name' => location_entry ? location_entry['name'] : location_name,
      'map_url' => location_entry ? location_entry['map_url'] : nil,
      'raw' => location_name
    }

    grouped[meta[:slug]] << {
      'summary' => title,
      'start' => occ[:start_time].iso8601,
      'end' => occ[:end_time]&.iso8601,
      'all_day' => occ[:all_day] || false,
      'status' => occ[:status],
      'location' => location_payload,
      'display_date' => format_date(occ[:start_time]),
      'display_time' => format_time_range(occ[:start_time], occ[:end_time], occ[:all_day]),
      'uid' => occ[:uid],
    }
  end

  schedule = {
    'generated_at' => Time.now.iso8601,
    'timezone' => SITE_TIMEZONE,
    'upcoming' => [],
    'scheduled_slugs' => [],
    'by_slug' => {}
  }

  grouped.each do |slug, occs|
    meta = meta_by_slug[slug]
    occs.sort_by! { |o| o['start'] }
    future = occs.select { |o| Time.parse(o['start']) >= now }

    schedule['by_slug'][slug] = {
      'slug' => slug,
      'title' => meta ? meta[:title] : grouped[slug].first['summary'],
      'banner' => meta ? meta[:banner] : nil,
      'intro' => meta ? meta[:intro] : nil,
      'ticket_link' => meta ? meta[:ticket_link] : nil,
      'page_url' => meta ? meta[:page_url] : "/events/#{slug}/",
      'occurrences' => occs,
      'next_occurrence' => future.first,
    }

    unless future.empty?
      schedule['scheduled_slugs'] << slug
      future.each do |occ|
        schedule['upcoming'] << {
          'slug' => slug,
          'title' => meta ? meta[:title] : occ['summary'],
          'page_url' => meta ? meta[:page_url] : "/events/#{slug}/",
          'banner' => meta ? meta[:banner] : nil,
          'intro' => meta ? meta[:intro] : nil,
          'ticket_link' => meta ? meta[:ticket_link] : nil,
          'start' => occ['start'],
          'end' => occ['end'],
          'display_date' => occ['display_date'],
          'display_time' => occ['display_time'],
          'location' => occ['location']
        }
      end
    end
  end

  schedule['scheduled_slugs'].uniq!
  schedule['upcoming'].sort_by! { |item| item['start'] }

  schedule
end

if $PROGRAM_NAME == __FILE__
  ENV['TZ'] = SITE_TIMEZONE
  base_dir = File.expand_path('..', __dir__)
  schedule = build_schedule(base_dir)
  output_path = File.join(base_dir, '_data', 'event_schedule.json')
  File.write(output_path, JSON.pretty_generate(schedule) + "\n")
  log "Wrote #{output_path}"
end
