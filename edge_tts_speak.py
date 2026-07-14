import asyncio, json, base64, sys, os
from edge_tts import Communicate

async def main():
    text = sys.argv[1] if len(sys.argv) > 1 else ''
    voice = sys.argv[2] if len(sys.argv) > 2 else 'th-TH-PremwadeeNeural'
    if not text:
        print(json.dumps({'error': 'NO_TEXT'}))
        return
    audio = bytearray()
    duration_ns = 0
    try:
        comm = Communicate(text, voice)
        async for chunk in comm.stream():
            if chunk['type'] == 'audio':
                audio.extend(chunk['data'])
            elif chunk['type'] in ('SentenceBoundary', 'WordBoundary'):
                off = chunk.get('offset', 0)
                dur = chunk.get('duration', 0)
                end_ns = off + dur
                if end_ns > duration_ns:
                    duration_ns = end_ns
        if not audio:
            print(json.dumps({'error': 'NO_AUDIO'}))
            return
        result = {
            'audio': base64.b64encode(bytes(audio)).decode('utf-8'),
            'duration': duration_ns / 1e7
        }
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({'error': str(e)}))

if __name__ == '__main__':
    asyncio.run(main())
