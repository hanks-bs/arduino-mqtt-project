/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import {
	createContext,
	useContext,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { io, type Socket } from "socket.io-client";

interface SocketIOContextValue {
	/** Flaga połączenia */
	isConnected: boolean;
	/** Map of latest payload by event name */
	events: Record<string, any>;
	/** Pobierz ostatnie dane dla danego eventu */
	getEvent: (name: string) => any;
}

const SocketIOContext = createContext<SocketIOContextValue>({
	isConnected: false,
	events: {},
	getEvent: () => null,
});

/** Hook zwracający całą wartość Contextu */
export function useSocketIO() {
	return useContext(SocketIOContext);
}

/** Hook zwracający tylko stan połączenia */
export function useSocketIOStatus() {
	return useSocketIO().isConnected;
}

/** Hook do subskrypcji konkretnego eventu */
export function useSocketIOEvent<T = any>(name: string): T | null {
	const { events } = useSocketIO();
	return (events[name] ?? null) as T | null;
}

interface Props {
	children: ReactNode;
}

/**
 * SocketIOProvider zapewnia kontekst połączenia do server-side Socket.IO.
 */
export function SocketIOProvider({ children }: Props) {
	const socketRef = useRef<Socket | null>(null);
	const [events, setEvents] = useState<Record<string, any>>({});
	const [isConnected, setIsConnected] = useState(false);

	useEffect(() => {
		// URL do serwera Socket.IO
		const url = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:5000";
		// inicjalizacja Socket.IO
		const socket = io(url, {
			path: "/socket.io", // domyślna ścieżka, dostosuj jeśli zmieniona
			transports: ["websocket"], // wymuszamy WebSocket
			autoConnect: true,
		});

		socket.on("connect", () => {
			setIsConnected(true);
			console.log("Socket.IO: connected, id=", socket.id);
		});

		socket.on("disconnect", reason => {
			setIsConnected(false);
			console.log("Socket.IO: disconnected, reason=", reason);
		});

		// Uniwersalne nasłuchiwanie dowolnego eventu
		socket.onAny((event, data) => {
			let parsed: any = data;
			// jeśli otrzymaliśmy string JSON, spróbuj sparsować
			if (typeof data === "string") {
				try {
					parsed = JSON.parse(data);
				} catch {
					console.warn(`Nie udało się sparsować JSON dla eventu "${event}"`);
				}
			}
			setEvents(prev => ({ ...prev, [event]: parsed }));
		});

		socketRef.current = socket;
		return () => {
			socket.disconnect();
		};
	}, []);

	const contextValue: SocketIOContextValue = {
		isConnected,
		events,
		getEvent: name => events[name] ?? null,
	};

	return (
		<SocketIOContext.Provider value={contextValue}>
			{children}
		</SocketIOContext.Provider>
	);
}
