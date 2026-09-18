"""config.model_kwargs(): temperature only for models that accept it."""
import importlib


def _reload_config(monkeypatch, model_id, temperature=None):
    monkeypatch.setenv("MODEL_ID", model_id)
    if temperature is None:
        monkeypatch.delenv("MODEL_TEMPERATURE", raising=False)
    else:
        monkeypatch.setenv("MODEL_TEMPERATURE", temperature)
    import config
    return importlib.reload(config)


def test_sonnet_4_6_keeps_the_low_temperature(monkeypatch):
    cfg = _reload_config(monkeypatch, "us.anthropic.claude-sonnet-4-6")
    assert cfg.model_kwargs() == {"model_id": "us.anthropic.claude-sonnet-4-6", "temperature": 0.1}


def test_models_that_deprecate_temperature_get_none(monkeypatch):
    for model_id in ("us.anthropic.claude-sonnet-5", "us.anthropic.claude-opus-5", "us.anthropic.claude-fable-5-1"):
        cfg = _reload_config(monkeypatch, model_id)
        assert cfg.model_kwargs() == {"model_id": model_id}, model_id


def test_temperature_none_disables_it_for_any_model(monkeypatch):
    cfg = _reload_config(monkeypatch, "us.anthropic.claude-sonnet-4-6", "none")
    assert cfg.model_kwargs() == {"model_id": "us.anthropic.claude-sonnet-4-6"}
    cfg = _reload_config(monkeypatch, "us.anthropic.claude-sonnet-4-6", "")
    assert cfg.MODEL_TEMPERATURE is None


def test_explicit_temperature_is_honoured(monkeypatch):
    cfg = _reload_config(monkeypatch, "us.anthropic.claude-haiku-4-5-20251001-v1:0", "0.3")
    assert cfg.model_kwargs()["temperature"] == 0.3
