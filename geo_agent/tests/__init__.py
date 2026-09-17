# Marks tests/ as a package so test modules can import shared constants from .conftest.
# The deploy zip excludes tests/ entirely (bedrock_agentcore_starter_toolkit dockerignore
# template), so nothing here reaches the runtime image.
