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
	/** Aktywuj/dezaktywuj połączenie (lazy connect / pełne odłączenie). */
	setActive: (active: boolean) => void;
}

const SocketIOContext = createContext<SocketIOContextValue>({
	isConnected: false,
	events: {},
	getEvent: () => null,
	setActive: () => {},
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

/** Hook do sterowania aktywnością połączenia */
export function useSocketIOActivation() {
	const { setActive, isConnected } = useSocketIO();
	return { setActive, isConnected };
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
	const activeRef = useRef<boolean>(true); // domyślnie aktywne

	const cleanupSocket = () => {
		if (socketRef.current) {
			try {
				socketRef.current.disconnect();
			} catch {}
			try {
				socketRef.current.close();
			} catch {}
			socketRef.current = null;
		}
		setIsConnected(false);
		setEvents({});
	};

	// trigger effect przez dedykowany licznik zamiast activeRef.current w deps
	const [activationSeq, setActivationSeq] = useState(0);
	useEffect(() => {
		if (!activeRef.current) return; // nie inicjuj kiedy nieaktywne
		if (socketRef.current) return; // już istnieje
		const url = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:5000";
		const socket = io(url, {
			path: "/socket.io",
			transports: ["websocket"],
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
		socket.onAny((event, data) => {
			let parsed: any = data;
			if (typeof data === "string") {
				try {
					parsed = JSON.parse(data);
				} catch {}
			}
			setEvents(prev => ({ ...prev, [event]: parsed }));
		});
		socketRef.current = socket;
		return () => {
			cleanupSocket();
		};
	}, [activationSeq]);

	const setActive = (active: boolean) => {
		if (activeRef.current === active) return;
		activeRef.current = active;
		if (!active) {
			cleanupSocket();
		} else {
			// zainicjuj nową sekwencję aktywacji
			setActivationSeq(s => s + 1);
		}
	};

	const contextValue: SocketIOContextValue = {
		isConnected,
		events,
		getEvent: name => events[name] ?? null,
		setActive,
	};

	return (
		<SocketIOContext.Provider value={contextValue}>
			{children}
		</SocketIOContext.Provider>
	);
}
