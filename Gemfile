source "https://rubygems.org"

# NOTE: production is served by GitHub Pages' default (legacy) Jekyll build,
# which pins Jekyll 3.9 + Liquid 4.0.3. Liquid 4.0.3 calls Object#tainted?,
# removed in Ruby 3.2+, so the `github-pages` gem cannot run on a modern Ruby.
# Local dev therefore uses Jekyll 4 with the same plugin set. The site uses only
# stock Liquid, collections, and plain CSS, so output matches in practice.
gem "jekyll", "~> 4.4"

group :jekyll_plugins do
  gem "jekyll-seo-tag"
  gem "jekyll-sitemap"
  gem "jekyll-feed"
end

# Formerly stdlib, unbundled in modern Ruby (3.4+ / 4.x).
gem "webrick", "~> 1.8"
gem "csv"
gem "logger"
gem "base64"
gem "bigdecimal"
gem "ostruct"
