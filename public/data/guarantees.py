from array import array
from bisect import bisect_left

from anysystem import Context, Message, Process

RESEND_DELAY = 4.0


class _ReliableSender(Process):
    def __init__(self, proc_id: str, receiver_id: str):
        self._id = proc_id
        self._receiver = receiver_id
        self._next_seq = 0
        self._pending = {}

    def on_local_message(self, msg: Message, ctx: Context):
        seq = self._next_seq
        self._next_seq += 1
        self._pending[seq] = msg["text"]
        ctx.send(Message("DATA", {"seq": seq, "text": msg["text"]}), self._receiver)
        ctx.set_timer(str(seq), RESEND_DELAY)

    def on_start(self, ctx: Context):
        pass

    def on_message(self, msg: Message, sender: str, ctx: Context):
        seq = msg["seq"]
        if seq in self._pending:
            del self._pending[seq]
            ctx.cancel_timer(str(seq))

    def on_timer(self, timer_name: str, ctx: Context):
        seq = int(timer_name)
        text = self._pending.get(seq)
        if text is None:
            return
        ctx.send(Message("DATA", {"seq": seq, "text": text}), self._receiver)
        ctx.set_timer(timer_name, RESEND_DELAY)

# AT MOST ONCE ---------------------------------------------------------------------------------------------------------

class AtMostOnceSender(Process):
    def __init__(self, proc_id: str, receiver_id: str):
        self._id = proc_id
        self._receiver = receiver_id
        self._next_seq = 0

    def on_local_message(self, msg: Message, ctx: Context):
        ctx.send(Message("DATA", {"seq": self._next_seq, "text": msg["text"]}), self._receiver)
        self._next_seq += 1

    def on_start(self, ctx: Context):
        pass

    def on_message(self, msg: Message, sender: str, ctx: Context):
        pass

    def on_timer(self, timer_name: str, ctx: Context):
        pass


class AtMostOnceReceiver(Process):
    def __init__(self, proc_id: str):
        self._id = proc_id
        self._max_seq = -1
        self._missing = array("i")

    def on_local_message(self, msg: Message, ctx: Context):
        pass

    def on_start(self, ctx: Context):
        pass

    def on_message(self, msg: Message, sender: str, ctx: Context):
        seq = msg["seq"]
        if seq > self._max_seq:
            self._missing.extend(range(self._max_seq + 1, seq))
            self._max_seq = seq
            ctx.send_local(Message("MESSAGE", {"text": msg["text"]}))
            return
        i = bisect_left(self._missing, seq)
        if i < len(self._missing) and self._missing[i] == seq:
            del self._missing[i]
            ctx.send_local(Message("MESSAGE", {"text": msg["text"]}))

    def on_timer(self, timer_name: str, ctx: Context):
        pass


# AT LEAST ONCE --------------------------------------------------------------------------------------------------------

class AtLeastOnceSender(_ReliableSender):
    pass


class AtLeastOnceReceiver(Process):
    def __init__(self, proc_id: str):
        self._id = proc_id

    def on_local_message(self, msg: Message, ctx: Context):
        pass

    def on_start(self, ctx: Context):
        pass

    def on_message(self, msg: Message, sender: str, ctx: Context):
        ctx.send_local(Message("MESSAGE", {"text": msg["text"]}))
        ctx.send(Message("ACK", {"seq": msg["seq"]}), sender)

    def on_timer(self, timer_name: str, ctx: Context):
        pass


# EXACTLY ONCE ---------------------------------------------------------------------------------------------------------

class ExactlyOnceSender(_ReliableSender):
    pass


class ExactlyOnceReceiver(Process):
    def __init__(self, proc_id: str):
        self._id = proc_id
        self._max_seq = -1
        self._missing = array("i")

    def on_local_message(self, msg: Message, ctx: Context):
        pass

    def on_start(self, ctx: Context):
        pass

    def on_message(self, msg: Message, sender: str, ctx: Context):
        seq = msg["seq"]
        ctx.send(Message("ACK", {"seq": seq}), sender)
        if seq > self._max_seq:
            self._missing.extend(range(self._max_seq + 1, seq))
            self._max_seq = seq
            ctx.send_local(Message("MESSAGE", {"text": msg["text"]}))
            return
        i = bisect_left(self._missing, seq)
        if i < len(self._missing) and self._missing[i] == seq:
            del self._missing[i]
            ctx.send_local(Message("MESSAGE", {"text": msg["text"]}))

    def on_timer(self, timer_name: str, ctx: Context):
        pass


# EXACTLY ONCE + ORDERED -----------------------------------------------------------------------------------------------

class ExactlyOnceOrderedSender(_ReliableSender):
    pass


class ExactlyOnceOrderedReceiver(Process):
    def __init__(self, proc_id: str):
        self._id = proc_id
        self._expected = 0
        self._buffer = {}

    def on_local_message(self, msg: Message, ctx: Context):
        pass

    def on_start(self, ctx: Context):
        pass

    def on_message(self, msg: Message, sender: str, ctx: Context):
        seq = msg["seq"]
        ctx.send(Message("ACK", {"seq": seq}), sender)
        if seq < self._expected or seq in self._buffer:
            return
        if seq == self._expected:
            ctx.send_local(Message("MESSAGE", {"text": msg["text"]}))
            self._expected += 1
            while self._expected in self._buffer:
                ctx.send_local(Message("MESSAGE", {"text": self._buffer.pop(self._expected)}))
                self._expected += 1
        else:
            self._buffer[seq] = msg["text"]

    def on_timer(self, timer_name: str, ctx: Context):
        pass
