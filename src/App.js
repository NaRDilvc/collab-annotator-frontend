import React, { useRef, useEffect, useState } from 'react';
import io from 'socket.io-client';
import './App.css';

const socket = io('https://collab-backend-vseb.onrender.com');

const randomColor = () =>
  '#' + Math.floor(Math.random() * 16777215).toString(16);

const userName = prompt('Enter your name:');
const userColor = randomColor();

export default function App() {
  const canvasRef = useRef(null);
  const [image, setImage] = useState(null);
  const imageRef = useRef(null);
  const [annotations, setAnnotations] = useState([]);
  const [drawing, setDrawing] = useState(false); // ✅ ADD THIS
  const [cursorPositions, setCursorPositions] = useState({});
  const [imageList, setImageList] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });

  const undoStack = useRef([]);
  const redoStack = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.tabIndex = 0;
    canvas.focus();
  }, []);

  useEffect(() => {
    if (!image) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = image;
    img.onload = () => {
      imageRef.current = img;
      redrawAll();
    };
  }, [image]);

  useEffect(() => {
    redrawAll();
  }, [annotations, scale, offset, selectedIndex]);

  useEffect(() => {
    socket.on('new-annotation', (data) => {
      setAnnotations((prev) => {
        const matchIndex = prev.findIndex(a =>
          a.x === data.x && a.y === data.y &&
          a.w === data.w && a.h === data.h &&
          !a.id
        );
        if (matchIndex !== -1) {
          const updated = [...prev];
          updated[matchIndex] = { ...updated[matchIndex], id: data.id };
          return updated;
        }
        return [...prev, data];
      });
    });

    socket.on('cursor-move', (data) => {
      setCursorPositions((prev) => ({
        ...prev,
        [data.userId]: {
          x: data.position.x,
          y: data.position.y,
          name: data.name,
          color: data.color,
        },
      }));
    });

    return () => {
      socket.off('new-annotation');
      socket.off('cursor-move');
    };
  }, []);

  useEffect(() => {
    fetch('https://collab-backend-vseb.onrender.com/images')
      .then((res) => res.json())
      .then((data) => setImageList(data))
      .catch((err) => console.error('Image list fetch error:', err));
  }, []);

  const pushUndo = (currentState) => {
    undoStack.current.push(currentState);
    redoStack.current = [];
  };

  const undo = () => {
    if (undoStack.current.length === 0) return;
    const prev = undoStack.current.pop();
    redoStack.current.push(annotations);
    setAnnotations(prev);
  };

  const redo = () => {
    if (redoStack.current.length === 0) return;
    const next = redoStack.current.pop();
    undoStack.current.push(annotations);
    setAnnotations(next);
  };

  const redrawAll = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!imageRef.current) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, offset.x, offset.y);

    ctx.drawImage(imageRef.current, 0, 0);

    annotations.forEach(({ x, y, w, h }, idx) => {
      ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
      ctx.fillRect(x, y, w, h);

      ctx.strokeStyle = idx === selectedIndex ? 'blue' : 'red';
      ctx.lineWidth = 2 / scale;
      ctx.strokeRect(x, y, w, h);
    });

    ctx.restore();
  };

  const handleMouseDown = (e) => {
    const x = (e.nativeEvent.offsetX - offset.x) / scale;
    const y = (e.nativeEvent.offsetY - offset.y) / scale;

    const clickedIndex = annotations.findIndex(a =>
      x >= a.x && x <= a.x + a.w &&
      y >= a.y && y <= a.y + a.h
    );

    if (clickedIndex !== -1) {
      setSelectedIndex(clickedIndex);
      setDragging(true);
      dragOffset.current = {
        x: x - annotations[clickedIndex].x,
        y: y - annotations[clickedIndex].y,
      };
      return;
    }

    if (isPanning.current) {
      panStart.current = {
        x: e.clientX - offset.x,
        y: e.clientY - offset.y,
      };
    } else {
      pushUndo([...annotations]);
      setDrawing(true);
      setAnnotations([...annotations, { x, y, w: 0, h: 0 }]);
    }
  };

  const handleMouseMove = (e) => {
    const { offsetX, offsetY } = e.nativeEvent;

    socket.emit('cursor-move', {
      userId: socket.id,
      position: { x: offsetX, y: offsetY },
      name: userName,
      color: userColor,
    });

    if (isPanning.current) {
      setOffset({
        x: e.clientX - panStart.current.x,
        y: e.clientY - panStart.current.y,
      });
    } else if (dragging && selectedIndex !== null) {
      const updated = [...annotations];
      updated[selectedIndex].x = (offsetX - offset.x) / scale - dragOffset.current.x;
      updated[selectedIndex].y = (offsetY - offset.y) / scale - dragOffset.current.y;
      setAnnotations(updated);
    } else if (drawing) {
      setAnnotations((prev) => {
        const newAnnots = [...prev];
        const last = newAnnots[newAnnots.length - 1];
        last.w = (offsetX - offset.x) / scale - last.x;
        last.h = (offsetY - offset.y) / scale - last.y;
        return newAnnots;
      });
    }
  };

  const handleMouseUp = () => {
    if (dragging) {
      pushUndo([...annotations]);
      const currentImage = imageList.find(img => img.url === image);
      const updatedAnnot = annotations[selectedIndex];
      fetch('https://collab-backend-vseb.onrender.com/annotations/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...updatedAnnot,
          imageName: currentImage?.name || '',
        }),
      });
      setDragging(false);
      setSelectedIndex(null);
      return;
    }

    if (!drawing) return;

    setDrawing(false);
    const newAnnot = annotations[annotations.length - 1];
    const currentImage = imageList.find(img => img.url === image);
    socket.emit('new-annotation', {
      ...newAnnot,
      imageName: currentImage?.name || '',
    });
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    const newScale = Math.min(Math.max(0.5, scale + delta), 3);
    setScale(newScale);
  };

  const handleKeyDown = (e) => {
    if (e.code === 'Space') isPanning.current = true;
    if (e.ctrlKey && e.code === 'KeyZ') undo();
    if (e.ctrlKey && e.code === 'KeyY') redo();
    if (e.code === 'Delete' && selectedIndex !== null) {
      pushUndo([...annotations]);
      const currentImage = imageList.find(img => img.url === image);
      const deletedAnnot = annotations[selectedIndex];
      fetch('https://collab-backend-vseb.onrender.com/annotations/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...deletedAnnot,
          imageName: currentImage?.name || '',
        }),
      });
      setAnnotations(prev => prev.filter((_, idx) => idx !== selectedIndex));
      setSelectedIndex(null);
    }
  };

  const handleKeyUp = (e) => {
    if (e.code === 'Space') isPanning.current = false;
  };

  const uploadImageToServer = async (file) => {
    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch('https://collab-backend-vseb.onrender.com/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Upload failed: ${text}`);
      }

      const data = await response.json();
      setImageList((prev) => [...prev, { name: data.name, url: data.url }]);
    } catch (err) {
      console.error('UPLOAD ERROR:', err);
      alert(err.message);
    }
  };

  const handleImageSelect = async (img) => {
    setImage(null);
    setAnnotations([]);
    setImage(img.url);
    try {
      const res = await fetch(`https://collab-backend-vseb.onrender.com/annotations/${img.name}`);
      const annots = await res.json();
      setAnnotations(annots);
    } catch (err) {
      console.error('Failed to load annotations:', err);
      setAnnotations([]);
    }
  };

  const renderCursors = () => {
    return Object.entries(cursorPositions).map(
      ([userId, { x, y, name, color }]) => (
        <div
          key={userId}
          className="cursor"
          style={{
            left: x + 10,
            top: y + 10,
            color: color || 'black',
          }}
        >
          👆 <strong>{name}</strong>
        </div>
      )
    );
  };

  return (
    <div className="App" style={{ display: 'flex' }}>
      <div className="sidebar">
        <h3>Image List</h3>
        <ul>
          {imageList.map((img, idx) => (
            <li key={idx} onClick={() => handleImageSelect(img)}>
              {img.name}
            </li>
          ))}
        </ul>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => uploadImageToServer(e.target.files[0])}
        />
      </div>
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        style={{ flexGrow: 1 }}
      ></canvas>
      {renderCursors()}
    </div>
  );
}
