import logging
import pathlib
from dataclasses import dataclass
from socketserver import StreamRequestHandler
import typing as t
import click
import socket
import gzip
import io
import shutil
import tempfile
from http_messages import *

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

CHUNK_SIZE = 64 * 1024


@dataclass
class HTTPServer:
    server_address: t.Tuple[str, int]
    socket: socket.socket
    server_domain: str
    working_directory: pathlib.Path


class HTTPHandler(StreamRequestHandler):
    server: HTTPServer

    # Use self.rfile and self.wfile to interact with the client
    # Access domain and working directory with self.server.{attr}
    def handle(self) -> None:
        first_line = self.rfile.readline()
        logger.info(f"Handle connection from {self.client_address}, first_line {first_line}")

        lines = [first_line]
        while lines[-1] not in (CRLF, b""):
            lines.append(self.rfile.readline())
        request = HTTPRequest.from_bytes(b"".join(lines))
        self.body_left = int(request.headers.get(HEADER_CONTENT_LENGTH.lower(), 0))
        status, body = self.process(request)
        self.read_body(None)
        self.send(request, status, body)

    def process(self, request):
        if request.headers.get(HEADER_HOST.lower(), "").lower() != self.server.server_domain.lower():
            return BAD_REQUEST, b"Host does not match the server domain"
        path = self.server.working_directory / request.path.lstrip("/")
        if request.method == GET:
            return self.get(path)
        if request.method == POST:
            return self.post(path, request.headers.get(HEADER_CREATE_DIRECTORY.lower()) == "True")
        if request.method == PUT:
            return self.put(path)
        if request.method == DELETE:
            return self.delete(path, request.headers.get(HEADER_REMOVE_DIRECTORY.lower()) == "True")
        return METHOD_NOT_ALLOWED, b"Method is not supported"

    def get(self, path):
        if path.is_dir():
            return OK, LF.join(child.name.encode() for child in path.iterdir())
        if path.is_file():
            return OK, path
        return NOT_FOUND, b"Path does not exist"

    def post(self, path, create_directory):
        if path.exists():
            return CONFLICT, b"Path already exists"
        if not path.parent.is_dir():
            return NOT_FOUND, b"Parent directory does not exist"
        if create_directory:
            path.mkdir()
        else:
            with path.open("wb") as file:
                self.read_body(file)
        return OK, b""

    def put(self, path):
        if path.is_dir():
            return CONFLICT, b"Path is a directory"
        if not path.is_file():
            return NOT_FOUND, b"File does not exist"
        with path.open("wb") as file:
            self.read_body(file)
        return OK, b""

    def delete(self, path, remove_directory):
        if path == self.server.working_directory:
            return FORBIDDEN, b"Working directory cannot be deleted"
        if path.is_dir() and not remove_directory:
            return NOT_ACCEPTABLE, b"Directory is deleted only with Remove-Directory: True"
        if path.is_dir():
            shutil.rmtree(path)
        elif path.is_file():
            path.unlink()
        else:
            return NOT_FOUND, b"Path does not exist"
        return OK, b""

    def read_body(self, file):
        while self.body_left > 0:
            chunk = self.rfile.read(min(CHUNK_SIZE, self.body_left))
            if not chunk:
                break
            self.body_left -= len(chunk)
            if file:
                file.write(chunk)

    def send(self, request, status, body):
        source = body.open("rb") if isinstance(body, pathlib.Path) else io.BytesIO(body)
        content_type = APPLICATION_OCTET_STREAM if isinstance(body, pathlib.Path) else TEXT_PLAIN
        headers = {HEADER_SERVER: "file-server", HEADER_CONNECTION: "close", HEADER_CONTENT_TYPE: content_type}
        if request.method == GET and status == OK and GZIP in request.headers.get(HEADER_ACCEPT_ENCODING.lower(), ""):
            source = compress(source)
            headers[HEADER_CONTENT_ENCODING] = GZIP
        headers[HEADER_CONTENT_LENGTH] = str(source.seek(0, io.SEEK_END))
        source.seek(0)
        self.wfile.write(HTTPResponse(HTTP_VERSION, status, headers).to_bytes())
        with source:
            shutil.copyfileobj(source, self.wfile, CHUNK_SIZE)


def compress(source):
    compressed = tempfile.TemporaryFile()
    with source, gzip.GzipFile(fileobj=compressed, mode="wb") as archive:
        shutil.copyfileobj(source, archive, CHUNK_SIZE)
    return compressed


@click.command()
@click.option("--host", envvar="SERVER_HOST", default="0.0.0.0", type=str)
@click.option("--port", envvar="SERVER_PORT", default=8080, type=int)
@click.option("--server-domain", envvar="SERVER_DOMAIN", default="localhost", type=str)
@click.option("--working-directory", envvar="SERVER_WORKING_DIRECTORY", type=str)
def main(host, port, server_domain, working_directory):
    if not working_directory:
        raise SystemExit(1)

    working_directory_path = pathlib.Path(working_directory)

    logger.info(
        f"Starting server on {host}:{port}, domain {server_domain}, working directory {working_directory}"
    )

    # Create a server socket
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)

    # Set SO_REUSEADDR option
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

    # Bind the socket object to the address and port
    s.bind((host, port))
    # Start listening for incoming connections
    s.listen()

    logger.info(f"Listening at {s.getsockname()}")
    server = HTTPServer((host, port), s, server_domain, working_directory_path)

    while True:
        # Accept any new connection (request, client_address)
        try:
            conn, addr = s.accept()
        except OSError:
            break

        try:
            # Handle the request
            HTTPHandler(conn, addr, server)

            # Close the connection
            conn.shutdown(socket.SHUT_WR)
            conn.close()
        except Exception as e:
            logger.error(e)
            conn.close()


if __name__ == "__main__":
    main()
