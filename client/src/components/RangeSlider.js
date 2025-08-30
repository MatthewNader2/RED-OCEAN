// File: src/components/RangeSlider.js
import React from "react";
import { Range, getTrackBackground } from "react-range";

const RangeSlider = ({ values, min, max, step, onChange }) => {
  // This safety check prevents the component from rendering with invalid props,
  // acting as a final defense against the crash.
  if (
    min >= max ||
    !values ||
    values.length < 2 ||
    values[0] < min ||
    values[1] > max
  ) {
    return null; // Render nothing if props are inconsistent
  }

  return (
    <Range
      values={values}
      step={step}
      min={min}
      max={max}
      onChange={onChange}
      renderTrack={({ props, children }) => (
        <div
          onMouseDown={props.onMouseDown}
          onTouchStart={props.onTouchStart}
          style={{
            ...props.style,
            height: "36px",
            display: "flex",
            width: "100%",
          }}
        >
          <div
            ref={props.ref}
            style={{
              height: "5px",
              width: "100%",
              borderRadius: "4px",
              background: getTrackBackground({
                values,
                colors: ["#ccc", "#007bff", "#ccc"],
                min,
                max,
              }),
              alignSelf: "center",
            }}
          >
            {children}
          </div>
        </div>
      )}
      renderThumb={({ props, isDragged }) => {
        const { key, ...thumbProps } = props;
        return (
          <div
            key={key}
            {...thumbProps}
            style={{
              ...props.style,
              height: "20px",
              width: "20px",
              borderRadius: "50%",
              backgroundColor: "#FFF",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              boxShadow: "0px 2px 6px #AAA",
              border: `2px solid ${isDragged ? "#0056b3" : "#007bff"}`,
            }}
          />
        );
      }}
    />
  );
};

export default RangeSlider;
