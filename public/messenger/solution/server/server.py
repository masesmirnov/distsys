import asyncio
import logging
import os
import time

import grpc

from solution.proto import messenger_pb2
from solution.proto import messenger_pb2_grpc


class MessengerServer(messenger_pb2_grpc.MessengerServerServicer):
    def __init__(self):
        self._subscribers = set()
        self._last_time_ns = 0

    async def SendMessage(self, request, context):
        send_time_ns = max(time.time_ns(), self._last_time_ns + 1)
        self._last_time_ns = send_time_ns
        message = messenger_pb2.ChatMessage(author=request.author, text=request.text)
        message.sendTime.FromNanoseconds(send_time_ns)
        for subscriber in self._subscribers:
            subscriber.put_nowait(message)
        return messenger_pb2.SendMessageResponse(sendTime=message.sendTime)

    async def ReadMessages(self, request, context):
        subscriber = asyncio.Queue()
        self._subscribers.add(subscriber)
        try:
            while True:
                yield await subscriber.get()
        finally:
            self._subscribers.discard(subscriber)


async def serve():
    port = os.environ.get('MESSENGER_SERVER_PORT', '51075')
    server = grpc.aio.server()
    messenger_pb2_grpc.add_MessengerServerServicer_to_server(MessengerServer(), server)
    server.add_insecure_port(f'0.0.0.0:{port}')
    await server.start()
    await server.wait_for_termination()


if __name__ == '__main__':
    logging.basicConfig()
    asyncio.run(serve())
