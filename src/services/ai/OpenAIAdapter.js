class OpenAIAdapter {
  constructor(client, model) {
    this._client = client;
    this._model = model;
  }

  async toolCall(system, userMessage, tool) {
    const response = await this._client.chat.completions.create({
      model: this._model,
      max_tokens: 256,
      temperature: 0,
      tools: [{ type: 'function', function: tool }],
      tool_choice: { type: 'function', function: { name: tool.name } },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMessage },
      ],
    });

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall) return null;
    return JSON.parse(toolCall.function.arguments);
  }

  async *streamText(system, userContent) {
    const stream = await this._client.chat.completions.create({
      model: this._model,
      max_tokens: 1024,
      stream: true,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ],
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}

module.exports = OpenAIAdapter;
