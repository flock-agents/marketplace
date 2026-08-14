#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
QUERY=$(echo "$PARAMS" | jq -r '.query // ""')
MAX_RESULTS=$(echo "$PARAMS" | jq -r '.maxResults // 10')

_require_browser_session
_validate_param "$QUERY" "query"

if ! [[ "$MAX_RESULTS" =~ ^[0-9]+$ ]]; then MAX_RESULTS=10; fi
if [ "$MAX_RESULTS" -gt 25 ]; then MAX_RESULTS=25; fi
if [ "$MAX_RESULTS" -lt 1 ]; then MAX_RESULTS=1; fi

ENCODED_QUERY=$(printf '%s' "$QUERY" | jq -sRr @uri)
SEARCH_URL="${BASE_URL}/ps/?q=${ENCODED_QUERY}"

SCROLL_ACTIONS=$(jq -nc '[
  {"action":"waitForSelector","selector":"[qa=\"product\"], [class*=\"ProductCard\"], [class*=\"product-card\"], .SKUDeck, .prod-deck, li[class*=\"PaginateItems\"]","delay":5000},
  {"action":"scroll","deltaY":600},
  {"action":"wait","delay":1000},
  {"action":"scroll","deltaY":600},
  {"action":"wait","delay":1000}
]')

EVAL_SCRIPT="(() => {
  const maxResults = ${MAX_RESULTS};
  const products = [];
  const cards = document.querySelectorAll('[qa=\"product\"], [class*=\"ProductCard\"], [class*=\"product-card\"], .SKUDeck, .prod-deck, li[class*=\"PaginateItems\"]');
  const items = cards.length > 0 ? cards : document.querySelectorAll('[class*=\"Product\"] a, [class*=\"item-info\"], .uiv2-list-box-img-container');

  items.forEach((el, i) => {
    if (i >= maxResults) return;
    const nameEl = el.querySelector('[class*=\"BrandName\"], [class*=\"prod-name\"], [class*=\"Name\"], h3, h4, .Description') || el;
    const priceEl = el.querySelector('[class*=\"DiscountPriceTile\"], [class*=\"selling-price\"], [class*=\"Price\"], [class*=\"sp\"]');
    const mrpEl = el.querySelector('[class*=\"MRPPrice\"], [class*=\"strike\"], s, del, [class*=\"mp\"]');
    const stockEl = el.querySelector('[class*=\"out-of-stock\"], [class*=\"OutOfStock\"], [class*=\"sold-out\"]');
    const imgEl = el.querySelector('img');
    const quantityEl = el.querySelector('[class*=\"PackChanger\"], [class*=\"weight\"], [class*=\"quantity\"], [class*=\"unit\"], [class*=\"Label\"]');
    const deliveryEl = el.querySelector('[class*=\"delivery\"], [class*=\"eta\"], [class*=\"minute\"]');
    const discountEl = el.querySelector('[class*=\"discount\"], [class*=\"offer\"], [class*=\"Offer\"], [class*=\"save\"]');
    const brandEl = el.querySelector('[class*=\"Brand\"], [class*=\"brand\"]');

    const link = el.closest('a')?.href || el.querySelector('a')?.href || '';
    const idMatch = link.match(/\\/pd\\/[\\w-]+\\/(\\d+)/) || link.match(/\\/(\\d{5,})/) || link.match(/\\/product\\/(\\w+)/);

    const name = (nameEl.textContent || '').trim().substring(0, 200);
    if (!name) return;

    const priceText = (priceEl?.textContent || '').replace(/[^\\d.]/g, '');
    const mrpText = (mrpEl?.textContent || '').replace(/[^\\d.]/g, '');

    products.push({
      id: idMatch ? idMatch[1] : 'unknown-' + i,
      name: name,
      brand: (brandEl?.textContent || '').trim().substring(0, 100),
      quantity: (quantityEl?.textContent || '').trim().substring(0, 50),
      price: priceText ? parseFloat(priceText) : null,
      mrp: mrpText ? parseFloat(mrpText) : null,
      discount: (discountEl?.textContent || '').trim().substring(0, 50) || null,
      inStock: !stockEl,
      imageUrl: imgEl?.src || null,
      deliveryEstimate: (deliveryEl?.textContent || '').trim().substring(0, 50) || null
    });
  });
  return JSON.stringify({ products, totalResults: items.length });
})()"

RESULT=$(_browser_interact "$SEARCH_URL" "$SCROLL_ACTIONS" "" "$EVAL_SCRIPT") || exit $?
CONTENT=$(echo "$RESULT" | jq -r '.content // "{}"')

PARSED=$(echo "$CONTENT" | jq -c '.' 2>/dev/null) || {
  _error_json "PAGE_CHANGED" "Could not find product listings on the page. The service may have updated its layout."
}

PRODUCTS=$(echo "$PARSED" | jq -r '.products // []')
TOTAL=$(echo "$PARSED" | jq -r '.totalResults // 0')

if [ "$(echo "$PRODUCTS" | jq 'length')" -eq 0 ]; then
  jq -nc --arg query "$QUERY" '{products: [], totalResults: 0, query: $query}'
  exit 0
fi

jq -nc --argjson products "$PRODUCTS" --argjson total "$TOTAL" --arg query "$QUERY" \
  '{products: $products, totalResults: $total, query: $query}'
