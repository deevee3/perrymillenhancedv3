import os
import feedparser
import requests

API_BASE = os.getenv("API_BASE", "http://localhost:3333/v1")
SERVICE_KEY = os.getenv("SERVICE_API_KEY", "local-dev-service-key")

DEFAULT_FEEDS = [
    "https://rss.feedspot.com/u/72252f9f2933826fe9d1a2da83d6122c/rss/rsscombiner",
    "https://rss.feedspot.com/folder/4BnLtF8d5g==/rss/rsscombiner",
    "https://rss.feedspot.com/folder/5hnLtWAh7A==/rss/rsscombiner",
]


def load_feeds() -> list[str]:
    raw = os.getenv("FEED_URLS")
    if raw:
        return [url.strip() for url in raw.split(",") if url.strip()]
    return DEFAULT_FEEDS


FEED_URLS = load_feeds()


def post_item(feed_url: str, entry: feedparser.FeedParserDict) -> None:
    payload = {
        "feed_url": feed_url,
        "guid": entry.get("id"),
        "title": entry.get("title"),
        "summary": entry.get("summary"),
        "link": entry.get("link"),
        "published_at": entry.get("published"),
    }
    response = requests.post(
        f"{API_BASE}/ingest/rss",
        json=payload,
        headers={"x-service-key": SERVICE_KEY},
        timeout=15,
    )
    response.raise_for_status()


def run_once() -> None:
    for feed_url in FEED_URLS:
        if not feed_url:
            continue
        parsed = feedparser.parse(feed_url)
        for entry in parsed.entries:
            post_item(feed_url, entry)


if __name__ == "__main__":
    run_once()
