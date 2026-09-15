def calculate_efficiency(input_power, output_power):
    if input_power == 0:
        return 0.0
    return (output_power / input_power) * 100.0

if __name__ == "__main__":
    p_in = 1500.0
    p_out = 1425.0
    efficiency = calculate_efficiency(p_in, p_out)
    print(f"System Efficiency: {efficiency:.2f}%")
