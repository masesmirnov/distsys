import os
import queue
import threading
import time
from concurrent import futures

import grpc
from google.protobuf.timestamp_pb2 import Timestamp

from solution.proto import messenger_pb2
from solution.proto import messenger_pb2_grpc


class MessengerServer(messenger_pb2_grpc.MessengerServerServicer):
    def __init__(self):
        self._lock = threading.Lock()
        self._subscribers = set()
        self._last_time_ns = 0

    def SendMessage(self, request, context):
        with self._lock:
            send_time_ns = max(time.time_ns(), self._last_time_ns + 1)
            self._last_time_ns = send_time_ns
            send_time = Timestamp()
            send_time.FromNanoseconds(send_time_ns)
            message = messenger_pb2.ChatMessage(
                author=request.author,
                text=request.text,
                sendTime=send_time,
            )
            for subscriber in self._subscribers:
                subscriber.put(message)
        return messenger_pb2.SendMessageResponse(sendTime=send_time)

    def ReadMessages(self, request, context):
        subscriber = queue.SimpleQueue()
        with self._lock:
            self._subscribers.add(subscriber)
        context.add_callback(lambda: subscriber.put(None))
        try:
            while True:
                message = subscriber.get()
                if message is None:
                    return
                yield message
        finally:
            with self._lock:
                self._subscribers.discard(subscriber)


def serve():
    port = os.environ.get('MESSENGER_SERVER_PORT', '51075')
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=100))
    messenger_pb2_grpc.add_MessengerServerServicer_to_server(MessengerServer(), server)
    server.add_insecure_port(f'0.0.0.0:{port}')
    server.start()
    server.wait_for_termination()


if __name__ == '__main__':
    serve()
