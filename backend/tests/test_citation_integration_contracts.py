from __future__ import annotations

from app.citations.integration import (
  CitationIntegrationEvent,
  CitationIntegrationQueue,
  EventEnvelope,
  InMemoryMessageBus,
  LocalQueueMessage,
  RawCitationObservation,
  RawCitationsObservedPayload,
)


def test_event_envelope_uses_wire_format_event_name():
  payload = RawCitationsObservedPayload(
    batch_id="batch-1",
    source_system="tree_forcing_scraper",
    observations=[
      RawCitationObservation(
        raw_citation_text="Whitehead, Alfred North. Process and Reality.",
        source_record_id="page-1:citation-1",
        source_kind="website_bibliography",
      )
    ],
  )

  envelope = EventEnvelope.wrap(
    name=CitationIntegrationEvent.RAW_CITATIONS_OBSERVED,
    producer="tree-forcing-scraper",
    payload=payload,
    correlation_id="batch-1",
    dedupe_key="scraper:page-1",
  )

  assert envelope.name == "citations.raw_citations.observed"
  assert envelope.payload["batch_id"] == "batch-1"
  assert envelope.payload["observations"][0]["raw_citation_text"].startswith("Whitehead")


def test_local_queue_message_and_in_memory_bus_round_trip():
  message = LocalQueueMessage.from_payload(
    queue_name=CitationIntegrationQueue.PURIFICATION,
    message_type=CitationIntegrationEvent.PURIFICATION_REQUESTED,
    payload={
      "batch_id": "batch-1",
      "raw_observation_ids": ["obs-1", "obs-2"],
    },
    dedupe_key="purify:batch-1",
  )
  bus = InMemoryMessageBus()

  bus.enqueue(message)
  taken = bus.dequeue("citations.purification")

  assert message.queue_name == "citations.purification"
  assert message.message_type == "citations.purification.requested"
  assert len(taken) == 1
  assert taken[0].payload["raw_observation_ids"] == ["obs-1", "obs-2"]
